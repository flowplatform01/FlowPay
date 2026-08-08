import "../config/network.js";
import { Worker } from "bullmq";
import { createRedisConnection } from "../config/redis.js";
import { prisma } from "../config/db.js";
import { reconcileTransaction } from "../modules/transactions/reconciliation.service.js";
import { dispatchAppRevenuePayoutWebhook, dispatchAppWebhook } from "../modules/webhooks/app-webhook.service.js";
import { processGatewayWebhook } from "../modules/webhooks/gateway-webhook.service.js";
import { processDuePayoutCoordinations } from "../modules/payouts/payout-coordination.service.js";
import { executeAsynchronousCharge } from "../modules/checkout/checkout.service.js";
import { processDueRevenuePayouts } from "../modules/revenue-payouts/revenue-payouts.service.js";
import { expireStalePendingCheckoutTransactions } from "../modules/transactions/transactions.service.js";

const retryWorkerConnection = createRedisConnection("worker:retry");
const webhookWorkerConnection = createRedisConnection("worker:webhook");
const chargeWorkerConnection = createRedisConnection("worker:charge");
const workerLogState = new Map<string, number>();

if (!retryWorkerConnection || !webhookWorkerConnection) {
  console.log("FlowPay worker started without Redis. Queue processing is disabled.");
} else {
  const retryWorker = new Worker(
    "retry-queue",
    async (job) => {
      if (job.name === "retry-transaction") {
        return reconcileTransaction({
          transactionId: job.data.transactionId,
          reason: `Retry scheduled for ${job.data.provider}`,
          attempt: job.attemptsMade + 1,
          forceReviewRecheck: Boolean(job.data.manual)
        });
      }

      if (job.name === "replay-webhook") {
        const log = await prisma.webhookLog.findUniqueOrThrow({
          where: { id: job.data.webhookLogId }
        });

        const payload =
          log.payload && typeof log.payload === "object" && !Array.isArray(log.payload)
            ? (log.payload as Record<string, unknown>)
            : {};

        const result = await processGatewayWebhook(log.provider, payload);

        await prisma.webhookLog.update({
          where: { id: log.id },
          data: {
            processed: result.processed,
            transactionId: result.transactionId ?? log.transactionId,
            errorMessage: result.processed ? null : result.reason
          }
        });

        await prisma.retryJob.create({
          data: {
            transactionId: result.transactionId ?? log.transactionId,
            queueName: "webhook-replay",
            reason: result.processed ? "Webhook replay processed" : (result.reason ?? "Webhook replay ignored"),
            status: result.processed ? "SUCCEEDED" : "FAILED",
            attempts: job.attemptsMade + 1,
            payload: {
              webhookLogId: log.id,
              provider: log.provider
            }
          }
        });

        return result;
      }

      throw new Error(`Unsupported retry queue job ${job.name}`);
    },
    {
      connection: retryWorkerConnection,
      concurrency: 5,
      lockDuration: 60_000
    }
  );

  const webhookWorker = new Worker(
    "webhook-queue",
    async (job) => {
      if (job.name === "dispatch-app-webhook") {
        return dispatchAppWebhook({
          transactionId: job.data.transactionId,
          eventType: job.data.eventType,
          attempt: job.attemptsMade + 1
        });
      }

      if (job.name === "dispatch-app-revenue-payout-webhook") {
        return dispatchAppRevenuePayoutWebhook({
          revenuePayoutId: job.data.revenuePayoutId,
          eventType: job.data.eventType,
          attempt: job.attemptsMade + 1
        });
      }

      throw new Error(`Unsupported webhook queue job ${job.name}`);
    },
    {
      connection: webhookWorkerConnection,
      concurrency: 10,
      lockDuration: 60_000
    }
  );

  retryWorker.on("error", (error) => {
    warnWorkerThrottled("retry-error", `[Worker] Retry worker connection error: ${formatErrorMessage(error)}`);
  });

  webhookWorker.on("error", (error) => {
    warnWorkerThrottled("webhook-error", `[Worker] Webhook worker connection error: ${formatErrorMessage(error)}`);
  });

  try {
    await Promise.all([retryWorker.waitUntilReady(), webhookWorker.waitUntilReady()]);
    console.log("FlowPay worker ready. Queue processing is enabled.");
  } catch (error) {
    warnWorkerThrottled(
      "queue-startup",
      `[Worker] Queue Redis is not ready yet; worker will keep reconnecting with backoff: ${formatErrorMessage(error)}`
    );
  }

}

if (chargeWorkerConnection) {
  const chargeWorker = new Worker(
    "charge-queue",
    async (job) => {
      if (job.name === "execute-charge") {
        return executeAsynchronousCharge({
          transactionId: job.data.transactionId,
          provider: job.data.provider,
          paymentMethod: job.data.paymentMethod
        });
      }

      throw new Error(`Unsupported charge queue job ${job.name}`);
    },
    {
      connection: chargeWorkerConnection,
      concurrency: 8,
      lockDuration: 90_000
    }
  );

  chargeWorker.on("error", (error) => {
    warnWorkerThrottled("charge-error", `[Worker] Charge worker connection error: ${formatErrorMessage(error)}`);
  });

  chargeWorker.on("failed", (job, error) => {
    console.warn(`[Worker] Charge job ${job?.id ?? "unknown"} failed: ${formatErrorMessage(error)}`);
  });

  try {
    await chargeWorker.waitUntilReady();
    console.log("FlowPay charge worker ready. Asynchronous provider execution is enabled.");
  } catch (error) {
    warnWorkerThrottled(
      "charge-startup",
      `[Worker] Charge queue Redis is not ready yet; worker will keep reconnecting: ${formatErrorMessage(error)}`
    );
  }
}

runWorkerSweep("stuck transaction reconciliation", reconcileStuckProcessingTransactions);
setInterval(() => {
  runWorkerSweep("stuck transaction reconciliation", reconcileStuckProcessingTransactions);
}, 60_000).unref();

runWorkerSweep("providerless processing review", markProviderlessProcessingTransactionsForReview);
setInterval(() => {
  runWorkerSweep("providerless processing review", markProviderlessProcessingTransactionsForReview);
}, 60_000).unref();

runWorkerSweep("stale pending checkout expiry", expireStalePendingCheckoutSessions);
setInterval(() => {
  runWorkerSweep("stale pending checkout expiry", expireStalePendingCheckoutSessions);
}, 15 * 60_000).unref();

runWorkerSweep("payout coordination execution", processDuePayoutCoordinations);
setInterval(() => {
  runWorkerSweep("payout coordination execution", processDuePayoutCoordinations);
}, 60_000).unref();

runWorkerSweep("revenue payout execution", processDueRevenuePayouts);
setInterval(() => {
  runWorkerSweep("revenue payout execution", processDueRevenuePayouts);
}, 60_000).unref();

setInterval(() => {
  // Keep the standalone worker process alive in local/dev shells.
}, 60_000);

function runWorkerSweep(label: string, operation: () => Promise<void>) {
  void operation().catch((error) => {
    console.warn(`[Worker] ${label} skipped after transient failure: ${formatErrorMessage(error)}`);
  });
}

function warnWorkerThrottled(key: string, message: string) {
  const now = Date.now();
  const last = workerLogState.get(key) ?? 0;
  if (now - last < 60_000) return;
  workerLogState.set(key, now);
  console.warn(message);
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function reconcileStuckProcessingTransactions() {
  const cutoff = new Date(Date.now() - 30_000);
  const transactions = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
      paymentAttempts: {
        some: {
          status: "PENDING",
          gatewayReference: { not: null }
        }
      }
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: 25
  });

  for (const transaction of transactions) {
    try {
      await reconcileTransaction({
        transactionId: transaction.id,
        reason: "Worker sweep for stuck processing transaction",
        attempt: 1
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      if (!message.includes("Provider status is still pending")) {
        console.warn(`[Worker] Stuck transaction reconciliation failed for ${transaction.id}: ${message}`);
      }
    }
  }
}

async function markProviderlessProcessingTransactionsForReview() {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const transactions = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
      paymentAttempts: { none: {} }
    },
    select: { id: true, status: true },
    orderBy: { updatedAt: "asc" },
    take: 25
  });

  for (const transaction of transactions) {
    try {
      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.transaction.updateMany({
          where: {
            id: transaction.id,
            status: "PROCESSING"
          },
          data: {
            status: "UNDER_REVIEW",
            failureReason: "Checkout processing timed out before a provider reference was recorded"
          }
        });

        if (updateResult.count !== 1) {
          return;
        }

        await tx.transactionEvent.create({
          data: {
            transactionId: transaction.id,
            eventType: "transaction.review_required",
            payload: {
              previousStatus: transaction.status,
              reason: "No payment attempt or provider reference was available for automatic reconciliation"
            }
          }
        });

        await tx.retryJob.create({
          data: {
            transactionId: transaction.id,
            queueName: "retry-queue",
            reason: "Moved providerless processing transaction to review",
            status: "FAILED",
            attempts: 1,
            payload: {
              previousStatus: transaction.status,
              reviewReason: "missing-provider-reference"
            }
          }
        });
      });
    } catch (error) {
      console.warn(`[Worker] Providerless processing review failed for ${transaction.id}: ${formatErrorMessage(error)}`);
    }
  }
}

async function expireStalePendingCheckoutSessions() {
  const result = await expireStalePendingCheckoutTransactions({
    olderThanMinutes: 12 * 60,
    limit: 100,
    reason: "Hosted checkout expired before customer authorization started"
  });

  const expired = "expired" in result ? (result.expired ?? 0) : 0;
  if (expired > 0) {
    console.log(`[Worker] Expired ${expired} stale pending hosted checkout session(s).`);
  }
}
