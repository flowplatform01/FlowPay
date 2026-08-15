import type { GatewayProvider, Prisma, TransactionStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { addQueueJobSafely, webhookQueue } from "../../lib/queues.js";
import { finalizeSettlementsForTransaction } from "../settlements/settlements.service.js";
import { recordPlatformFeeCapture } from "../treasury/treasury.service.js";
import { processRevenuePayoutProviderWebhook } from "../revenue-payouts/revenue-payouts.service.js";

type GatewayProviderValue = GatewayProvider;

type GatewayWebhookResult = {
  processed: boolean;
  reason?: string;
  transactionId?: string;
  revenuePayoutId?: string;
  status?: string;
  deduplicated?: boolean;
};

export async function processGatewayWebhook(
  provider: GatewayProviderValue,
  payload: Record<string, unknown>
): Promise<GatewayWebhookResult> {
  const providerReference = extractProviderReference(provider, payload);
  const externalReference = extractExternalReference(payload);
  const mappedStatus = mapProviderStatus(provider, payload);

  if (!providerReference && !externalReference) {
    return { processed: false, reason: "No transaction reference found in webhook payload" };
  }

  const lookupClauses = [
    providerReference
      ? {
          paymentAttempts: {
            some: { gatewayReference: providerReference }
          }
        }
      : null,
    externalReference ? { id: externalReference } : null,
    externalReference ? { externalReference } : null
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  const transaction = await prisma.transaction.findFirst({
    where: lookupClauses.length > 0 ? { OR: lookupClauses } : undefined,
    include: {
      paymentAttempts: { orderBy: { startedAt: "desc" }, take: 3 }
    }
  });

  if (!transaction) {
    const payoutResult = await processRevenuePayoutProviderWebhook(provider, payload);
    if (payoutResult.processed) {
      return payoutResult;
    }

    return { processed: false, reason: "Transaction or revenue payout not found for webhook payload" };
  }

  if (transaction.selectedProvider !== provider) {
    return {
      processed: false,
      reason: `Ignored ${provider} webhook for ${transaction.selectedProvider} transaction`,
      transactionId: transaction.id
    };
  }

  if (transaction.status === mappedStatus) {
    return { processed: true, transactionId: transaction.id, status: mappedStatus, deduplicated: true };
  }

  if (isTerminal(transaction.status) && transaction.status !== mappedStatus) {
    return {
      processed: false,
      reason: `Ignored transition from terminal status ${transaction.status}`,
      transactionId: transaction.id
    };
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: mappedStatus,
          failureReason: mappedStatus === "FAILED" ? extractFailureReason(payload) : null
        }
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: `gateway.webhook.${mappedStatus.toLowerCase()}`,
          payload: payload as Prisma.InputJsonValue
        }
      });

      await finalizeSettlementsForTransaction(tx, {
        transactionId: transaction.id,
        status: mappedStatus,
        orchestrationMode: transaction.orchestrationMode,
        settlementStrategy: transaction.settlementStrategy
      });

      if (mappedStatus === "SUCCEEDED") {
        await recordPlatformFeeCapture(tx, {
          id: transaction.id,
          status: mappedStatus,
          currency: transaction.currency,
          platformFeeAmount: transaction.platformFeeAmount,
          externalReference: transaction.externalReference,
          selectedProvider: transaction.selectedProvider,
          appId: transaction.appId,
          organizationId: transaction.organizationId
        });
      }

      if (
        mappedStatus === "SUCCEEDED" &&
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
            provider,
            status: "PENDING",
            idempotencyKey: `payout:${transaction.id}:${transaction.destinationProfileId ?? "none"}`,
            requestPayload: payload as Prisma.InputJsonValue
          }
        });
      }
    },
    prismaTransactionOptions
  );

  await prisma.auditLog.create({
    data: {
      actorType: "GATEWAY",
      actorId: provider,
      action: "gateway.webhook_processed",
      entityType: "Transaction",
      entityId: transaction.id,
      payload: {
        providerReference,
        mappedStatus
      }
    }
  });

  if (webhookQueue) {
    const queue = webhookQueue;
    const eventType = `transaction.${mappedStatus.toLowerCase()}`;
    const queueResult = await addQueueJobSafely("webhook-queue", () =>
      queue.add(
        "dispatch-app-webhook",
        {
          transactionId: transaction.id,
          eventType
        },
        {
          jobId: `webhook:${transaction.id}:${eventType}`
        }
      )
    );

    if (!queueResult.enqueued) {
      await prisma.retryJob.create({
        data: {
          transactionId: transaction.id,
          queueName: "webhook-queue",
          reason: `Webhook queue unavailable during gateway webhook dispatch: ${queueResult.reason}`,
          status: "FAILED"
        }
      });
    }
  }

  if (isTerminal(mappedStatus)) {
    const { maybeFinalizeCreditPurchaseFromTransaction } = await import("../credits/credits.service.js");
    await maybeFinalizeCreditPurchaseFromTransaction({
      id: transaction.id,
      status: mappedStatus,
      metadata: transaction.metadata,
      settlementAmount: transaction.settlementAmount,
      failureReason: mappedStatus === "FAILED" ? extractFailureReason(payload) : null
    });

    const { maybeFinalizeRecipientVerificationFromTransaction } = await import("../destination-profiles/destination-profiles.service.js");
    await maybeFinalizeRecipientVerificationFromTransaction({
      id: transaction.id,
      appId: transaction.appId,
      status: mappedStatus,
      metadata: transaction.metadata,
      failureReason: mappedStatus === "FAILED" ? extractFailureReason(payload) : null
    });
  }

  return { processed: true, transactionId: transaction.id, status: mappedStatus };
}

function extractProviderReference(provider: GatewayProviderValue, payload: Record<string, unknown>) {
  const candidates = [
    payload.reference,
    payload.transId,
    payload.transaction_id,
    payload.transactionId,
    payload.payment_token,
    payload.cpm_reference
  ];

  const value = candidates.find((item) => typeof item === "string" && item.length > 0);
  return value?.toString();
}

function extractExternalReference(payload: Record<string, unknown>) {
  const candidates = [
    payload.external_reference,
    payload.externalReference,
    payload.externalId,
    payload.order_id,
    payload.transaction_id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  if (payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)) {
    const nested = (payload.metadata as Record<string, unknown>).transactionId;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }

  return undefined;
}

function extractFailureReason(payload: Record<string, unknown>) {
  const candidates = [payload.reason, payload.message, payload.error, payload.description];
  const value = candidates.find((item) => typeof item === "string" && item.length > 0);
  return value?.toString() ?? "Gateway reported failure";
}

function mapProviderStatus(provider: GatewayProviderValue, payload: Record<string, unknown>): TransactionStatus {
  const raw = String(
    payload.status ?? payload.payment_status ?? payload.transaction_status ?? payload.event ?? ""
  ).toUpperCase();

  if (
    raw.includes("SUCCESS") ||
    raw.includes("SUCCESSFUL") ||
    raw.includes("COMPLETED") ||
    raw.includes("PAID")
  ) {
    return "SUCCEEDED";
  }

  if (raw.includes("FAIL") || raw.includes("CANCEL") || raw.includes("REJECT")) {
    return "FAILED";
  }

  if (raw.includes("EXPIRED")) {
    return "EXPIRED";
  }

  if (provider === "CINETPAY" && payload.cpm_error_message) {
    return "FAILED";
  }

  return "PROCESSING";
}

function isTerminal(status: TransactionStatus) {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status);
}
