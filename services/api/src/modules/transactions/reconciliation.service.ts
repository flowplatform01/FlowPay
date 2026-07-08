import type { GatewayProvider, Prisma, TransactionStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { addQueueJobSafely, webhookQueue } from "../../lib/queues.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import type { GatewayStatusResult } from "../gateways/gateway.types.js";
import { finalizeSettlementsForTransaction } from "../settlements/settlements.service.js";
import { recordPlatformFeeCapture } from "../treasury/treasury.service.js";

const terminalStatuses: TransactionStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "UNDER_REVIEW"];

export async function reconcileTransaction(input: {
  transactionId: string;
  reason?: string;
  attempt: number;
  forceReviewRecheck?: boolean;
}) {
  const transaction = await prisma.transaction.findUnique({
    where: { id: input.transactionId },
    include: {
      paymentAttempts: {
        orderBy: { startedAt: "desc" },
        take: 1
      }
    }
  });

  if (!transaction) {
    throw new Error(`Transaction ${input.transactionId} not found for reconciliation`);
  }

  const shouldRecheckReview = input.forceReviewRecheck && transaction.status === "UNDER_REVIEW";

  if (terminalStatuses.includes(transaction.status) && !shouldRecheckReview) {
    await recordReconciliation({
      transactionId: transaction.id,
      status: "SUCCEEDED",
      attempts: input.attempt,
      reason: `Skipped terminal transaction ${transaction.status}`,
      payload: { currentStatus: transaction.status }
    });
    return { reconciled: false, status: transaction.status, skipped: true };
  }

  const latestAttempt = transaction.paymentAttempts[0];
  const providerStatus = await fetchProviderStatus(transaction.selectedProvider, latestAttempt?.gatewayReference);
  const providerInferredStatus = mapGatewayStatus(providerStatus.result);

  if (
    providerInferredStatus === "SUCCEEDED" &&
    providerStatus.result &&
    hasProviderAmountMismatch(transaction, providerStatus.result)
  ) {
    await markUnderReview({
      transactionId: transaction.id,
      previousStatus: transaction.status,
      latestAttemptId: latestAttempt?.id,
      providerStatus: providerStatus.result,
      reason: "Provider amount or currency mismatch during reconciliation"
    });

    await recordReconciliation({
      transactionId: transaction.id,
      status: "FAILED",
      attempts: input.attempt,
      reason: "Provider amount or currency mismatch during reconciliation",
      payload: {
        currentStatus: transaction.status,
        latestAttemptId: latestAttempt?.id,
        providerStatus: providerStatus.result
      }
    });

    return { reconciled: true, status: "UNDER_REVIEW" };
  }

  const inferredStatus = providerInferredStatus ?? inferStatusFromAttempt(latestAttempt);

  if (!inferredStatus) {
    const retryable =
      input.attempt < 6 &&
      Boolean(latestAttempt?.gatewayReference) &&
      (providerStatus.result?.status === "PENDING" || Boolean(providerStatus.error));
    const reason =
      providerStatus.result?.status === "PENDING"
        ? "Provider status is still pending"
        : providerStatus.error ?? input.reason ?? "No authoritative gateway status available for reconciliation";

    await recordReconciliation({
      transactionId: transaction.id,
      status: retryable ? "QUEUED" : "FAILED",
      attempts: input.attempt,
      reason,
      payload: {
        currentStatus: transaction.status,
        latestAttemptId: latestAttempt?.id,
        providerStatus: providerStatus.result
      }
    });

    if (retryable) {
      throw new Error(reason);
    }

    return { reconciled: false, status: transaction.status };
  }

  if (inferredStatus === transaction.status) {
    await recordReconciliation({
      transactionId: transaction.id,
      status: "SUCCEEDED",
      attempts: input.attempt,
      reason: `Transaction already matches inferred status ${inferredStatus}`,
      payload: { inferredStatus }
    });
    return { reconciled: false, status: transaction.status, deduplicated: true };
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: inferredStatus,
          failureReason: inferredStatus === "FAILED" ? "Reconciliation inferred gateway failure" : null
        }
      });

      if (latestAttempt) {
        await tx.paymentAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            status: inferredStatus === "SUCCEEDED" ? "SUCCESS" : "FAILED",
            completedAt: new Date()
          }
        });
      }

      await tx.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: `transaction.reconciled.${inferredStatus.toLowerCase()}`,
          payload: {
            previousStatus: transaction.status,
            inferredStatus,
            latestAttemptId: latestAttempt?.id,
            providerStatus: providerStatus.result
          } as Prisma.InputJsonValue
        }
      });

      await finalizeSettlementsForTransaction(tx, {
        transactionId: transaction.id,
        status: inferredStatus,
        orchestrationMode: transaction.orchestrationMode,
        settlementStrategy: transaction.settlementStrategy
      });

      if (inferredStatus === "SUCCEEDED") {
        await recordPlatformFeeCapture(tx, {
          id: transaction.id,
          status: inferredStatus,
          currency: transaction.currency,
          platformFeeAmount: transaction.platformFeeAmount,
          externalReference: transaction.externalReference,
          selectedProvider: transaction.selectedProvider,
          appId: transaction.appId,
          organizationId: transaction.organizationId
        });
      }

      if (
        inferredStatus === "SUCCEEDED" &&
        transaction.orchestrationMode === "MULTI_TENANT" &&
        transaction.settlementStrategy === "TWO_STEP_MIRROR"
      ) {
        await tx.payoutCoordination.upsert({
          where: {
            idempotencyKey: `payout:${transaction.id}:${transaction.destinationProfileId ?? "none"}`
          },
          update: {},
          create: {
            transactionId: transaction.id,
            destinationProfileId: transaction.destinationProfileId,
            provider: transaction.selectedProvider,
            status: "PENDING",
            idempotencyKey: `payout:${transaction.id}:${transaction.destinationProfileId ?? "none"}`,
            requestPayload: {
              providerStatus: providerStatus.result
            } as Prisma.InputJsonValue
          }
        });
      }
    },
    prismaTransactionOptions
  );

  await recordReconciliation({
    transactionId: transaction.id,
    status: "SUCCEEDED",
    attempts: input.attempt,
    reason: `Reconciled transaction to ${inferredStatus}`,
    payload: {
      previousStatus: transaction.status,
      inferredStatus,
      providerStatus: providerStatus.result
    }
  });

  if (webhookQueue) {
    const queue = webhookQueue;
    const queueResult = await addQueueJobSafely("webhook-queue", () =>
      queue.add(
        "dispatch-app-webhook",
        {
          transactionId: transaction.id,
          eventType: `transaction.${inferredStatus.toLowerCase()}`
        },
        {
          jobId: `webhook:${transaction.id}:transaction.${inferredStatus.toLowerCase()}`
        }
      )
    );

    if (!queueResult.enqueued) {
      await recordReconciliation({
        transactionId: transaction.id,
        status: "FAILED",
        attempts: input.attempt,
        reason: `Webhook queue unavailable after reconciliation: ${queueResult.reason}`,
        payload: {
          inferredStatus
        }
      });
    }
  }

  const { maybeFinalizeCreditPurchaseFromTransaction } = await import("../credits/credits.service.js");
  await maybeFinalizeCreditPurchaseFromTransaction({
    id: transaction.id,
    status: inferredStatus,
    metadata: transaction.metadata,
    settlementAmount: transaction.settlementAmount,
    failureReason: transaction.failureReason
  });

  const { maybeFinalizeRecipientVerificationFromTransaction } = await import("../destination-profiles/destination-profiles.service.js");
  await maybeFinalizeRecipientVerificationFromTransaction({
    id: transaction.id,
    appId: transaction.appId,
    status: inferredStatus,
    metadata: transaction.metadata,
    failureReason: transaction.failureReason
  });

  return { reconciled: true, status: inferredStatus };
}

async function fetchProviderStatus(
  provider: GatewayProvider,
  providerReference?: string | null
) {
  if (!providerReference) {
    return { result: null, error: null };
  }

  const adapter = getGatewayAdapter(provider);
  if (!adapter.getTransactionStatus) {
    return { result: null, error: `${provider} adapter does not expose transaction status lookup` };
  }

  try {
    const result = await adapter.getTransactionStatus(providerReference);
    return { result, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider status lookup failed";
    return { result: null, error: message };
  }
}

function mapGatewayStatus(result: GatewayStatusResult | null): TransactionStatus | null {
  if (!result) return null;
  if (result.status === "SUCCESS") return "SUCCEEDED";
  if (result.status === "FAILED") return "FAILED";
  return null;
}

function hasProviderAmountMismatch(
  transaction: {
    grossAmount: Prisma.Decimal;
    currency: string;
  },
  providerStatus: GatewayStatusResult
) {
  if (providerStatus.amount !== undefined && providerStatus.amount !== Number(transaction.grossAmount)) {
    return true;
  }

  return Boolean(providerStatus.currency && providerStatus.currency !== transaction.currency);
}

async function markUnderReview(input: {
  transactionId: string;
  previousStatus: TransactionStatus;
  latestAttemptId?: string;
  providerStatus: GatewayStatusResult;
  reason: string;
}) {
  await prisma.$transaction(
    async (tx) => {
      await tx.transaction.update({
        where: { id: input.transactionId },
        data: {
          status: "UNDER_REVIEW",
          failureReason: input.reason
        }
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: input.transactionId,
          eventType: "transaction.reconciliation_under_review",
          payload: {
            previousStatus: input.previousStatus,
            latestAttemptId: input.latestAttemptId,
            providerStatus: input.providerStatus,
            reason: input.reason
          } as Prisma.InputJsonValue
        }
      });
    },
    prismaTransactionOptions
  );
}

function inferStatusFromAttempt(
  attempt:
    | {
        status: string;
        responsePayload: unknown;
      }
    | undefined
): TransactionStatus | null {
  if (!attempt) return null;

  if (attempt.status === "SUCCESS") return "SUCCEEDED";
  if (attempt.status === "FAILED") return "FAILED";

  const rawStatus = readRawStatus(attempt.responsePayload);
  if (!rawStatus) return null;

  if (rawStatus.includes("SUCCESS") || rawStatus.includes("COMPLETED") || rawStatus.includes("PAID")) {
    return "SUCCEEDED";
  }

  if (rawStatus.includes("FAIL") || rawStatus.includes("CANCEL") || rawStatus.includes("REJECT")) {
    return "FAILED";
  }

  return null;
}

function readRawStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const record = payload as Record<string, unknown>;
  const value = record.status ?? record.payment_status ?? record.transaction_status;
  return typeof value === "string" ? value.toUpperCase() : null;
}

async function recordReconciliation(input: {
  transactionId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  reason: string;
  payload: Record<string, unknown>;
}) {
  await prisma.retryJob.create({
    data: {
      transactionId: input.transactionId,
      queueName: "retry-queue",
      reason: input.reason,
      status: input.status,
      attempts: input.attempts,
      payload: input.payload as Prisma.InputJsonValue
    }
  });
}
