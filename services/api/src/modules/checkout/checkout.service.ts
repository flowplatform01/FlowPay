import { Prisma, type GatewayProvider, type TransactionStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { env } from "../../config/env.js";
import { addQueueJobSafely, retryQueue, webhookQueue } from "../../lib/queues.js";
import { generateOpaqueKey } from "../../utils/crypto.js";
import { LatencyTimer } from "../../utils/performance.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import { assertProviderCanAcceptTraffic } from "../providers/provider-registry.js";
import { reconcileTransaction } from "../transactions/reconciliation.service.js";
import { finalizeSettlementsForTransaction } from "../settlements/settlements.service.js";
import { recordPlatformFeeCapture } from "../treasury/treasury.service.js";
import {
  getPaymentMethodForProvider,
  listCheckoutPaymentMethods,
  listPublicPaymentMethods,
  resolveOperationalProviderFromPaymentMethod,
  resolveProviderFromPaymentMethod,
  type PaymentMethodId
} from "../payments/payment-channels.js";
import { CONFIRMATION_GATEWAY_WORKFLOWS } from "../confirmation-gateway/confirmation-gateway.types.js";
import { getCreditBalance } from "../credits/credits.service.js";

type GatewayProviderValue = GatewayProvider;

const checkoutReconciliationProbeState = new Map<string, number>();
const CHECKOUT_RECONCILIATION_MIN_AGE_MS = 8_000;
const CHECKOUT_RECONCILIATION_THROTTLE_MS = 15_000;

type TransactionMetadata = {
  checkoutSessionToken?: string;
  hostedCheckout?: boolean;
  selectedPaymentMethod?: PaymentMethodId;
  recipientName?: string;
  recipientAccount?: string;
  checkoutDescription?: string;
  transferPurpose?: string;
  transactionNote?: string;
  __flowpay_credit_purchase?: boolean;
  purchaseIntentId?: string;
  __flowpay_confirmation_gateway?: string;
};

export function createCheckoutSessionToken() {
  return generateOpaqueKey("fchk");
}

export function readTransactionMetadata(metadata: unknown): TransactionMetadata {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as TransactionMetadata;
  }

  return {};
}

export function verifyCheckoutSessionToken(metadata: unknown, token?: string) {
  const stored = readTransactionMetadata(metadata).checkoutSessionToken;
  return Boolean(token && stored && stored === token);
}

export function buildHostedCheckoutUrl(transactionId: string, sessionToken: string) {
  const base = env.FLOWPAY_PUBLIC_URL.replace(/\/$/, "");
  const params = new URLSearchParams({
    token: sessionToken,
    embed: "1"
  });
  return `${base}/checkout/${transactionId}?${params.toString()}`;
}

export function serializeCheckoutSession(transaction: {
  id: string;
  externalReference: string;
  amount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  platformFeeAmount: Prisma.Decimal;
  gatewayFeeAmount: Prisma.Decimal;
  currency: string;
  customerName: string | null;
  status: TransactionStatus;
  failureReason: string | null;
  selectedProvider: GatewayProvider;
  orchestrationMode: string;
  settlementStrategy: string;
  externalRecipientId: string | null;
  metadata: unknown;
  organization: { name: string };
}) {
  const metadata = readTransactionMetadata(transaction.metadata);
  const paymentMethod =
    metadata.selectedPaymentMethod ?? getPaymentMethodForProvider(transaction.selectedProvider).id;

  return {
    id: transaction.id,
    externalReference: transaction.externalReference,
    amount: Number(transaction.amount),
    grossAmount: Number(transaction.grossAmount),
    platformFeeAmount: Number(transaction.platformFeeAmount),
    gatewayFeeAmount: Number(transaction.gatewayFeeAmount),
    currency: transaction.currency,
    customerName: transaction.customerName,
    organizationName: transaction.organization.name,
    status: transaction.status,
    failureReason: transaction.failureReason,
    recipientName: metadata.recipientName,
    recipientAccount: metadata.recipientAccount,
    paymentDescription: metadata.checkoutDescription ?? metadata.transferPurpose ?? metadata.transactionNote,
    paymentMethod,
    paymentMethods: listPublicPaymentMethods(
      transaction.externalRecipientId ? transaction.selectedProvider : undefined
    ),
    canConfirm: ["PENDING", "REQUIRES_ACTION", "PROCESSING"].includes(transaction.status),
    isCreditPurchase: Boolean(metadata.__flowpay_credit_purchase),
    confirmationGatewayWorkflow: metadata.__flowpay_confirmation_gateway ?? null
  };
}

export async function enrichCheckoutSession(
  transaction: Parameters<typeof serializeCheckoutSession>[0] & { appId?: string }
) {
  const base = {
    ...serializeCheckoutSession(transaction),
    paymentMethods: await listCheckoutPaymentMethods(
      transaction.externalRecipientId ? transaction.selectedProvider : undefined
    )
  };
  const metadata = readTransactionMetadata(transaction.metadata);

  if (!metadata.__flowpay_credit_purchase || !transaction.appId) {
    return base;
  }

  try {
    const balance = await getCreditBalance(transaction.appId);
    const purchaseAmountXaf = Number(transaction.amount);
    const projectedEffectiveBalance = balance.effectiveBalance + purchaseAmountXaf;

    return {
      ...base,
      confirmationGatewayWorkflow: CONFIRMATION_GATEWAY_WORKFLOWS.CREDIT_TOPUP,
      creditTopUp: {
        workflow: CONFIRMATION_GATEWAY_WORKFLOWS.CREDIT_TOPUP,
        purchaseAmountXaf,
        currentEffectiveBalance: balance.effectiveBalance,
        projectedEffectiveBalance,
        posture: balance.posture
      }
    };
  } catch {
    return base;
  }
}

export async function refreshCheckoutSessionState<T extends {
  id: string;
  status: TransactionStatus;
  updatedAt: Date;
  paymentAttempts: Array<{
    gatewayReference: string | null;
    startedAt: Date;
  }>;
}>(transaction: T): Promise<T> {
  if (transaction.status !== "PROCESSING") {
    return transaction;
  }

  const hasProviderReference = transaction.paymentAttempts.some((attempt) => Boolean(attempt.gatewayReference));
  if (!hasProviderReference || Date.now() - transaction.updatedAt.getTime() < CHECKOUT_RECONCILIATION_MIN_AGE_MS) {
    return transaction;
  }

  const lastProbeAt = checkoutReconciliationProbeState.get(transaction.id) ?? 0;
  if (Date.now() - lastProbeAt < CHECKOUT_RECONCILIATION_THROTTLE_MS) {
    return transaction;
  }

  checkoutReconciliationProbeState.set(transaction.id, Date.now());

  try {
    await reconcileTransaction({
      transactionId: transaction.id,
      reason: "Checkout status poll reconciliation",
      attempt: 6
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Provider status is still pending")) {
      console.warn(`[Checkout] Status reconciliation skipped for ${transaction.id}: ${message}`);
    }
  }

  return prisma.transaction.findUniqueOrThrow({
    where: { id: transaction.id },
    include: {
      paymentAttempts: true,
      events: true,
      settlements: true,
      organization: true
    }
  }) as unknown as Promise<T>;
}

export async function confirmHostedCheckout(input: {
  transactionId: string;
  sessionToken: string;
  paymentMethod: PaymentMethodId;
}) {
  const timer = new LatencyTimer();
  const transaction = await prisma.transaction.findUnique({
    where: { id: input.transactionId },
    include: {
      organization: true,
      paymentAttempts: { orderBy: { startedAt: "desc" }, take: 1 }
    }
  });
  timer.mark("load-checkout-transaction");

  if (!transaction) {
    throw new Error("Checkout session not found");
  }

  if (!verifyCheckoutSessionToken(transaction.metadata, input.sessionToken)) {
    throw new Error("Invalid checkout session token");
  }

  if (transaction.status === "SUCCEEDED") {
    return prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { organization: true, paymentAttempts: true }
    });
  }

  if (transaction.status === "PROCESSING" && transaction.paymentAttempts.length > 0) {
    return prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { organization: true, paymentAttempts: true }
    });
  }

  if (["FAILED", "CANCELLED", "EXPIRED"].includes(transaction.status)) {
    throw new Error(`Payment cannot be completed while status is ${transaction.status}`);
  }

  const paymentMethodProvider = await resolveOperationalProviderFromPaymentMethod(input.paymentMethod);
  const provider = transaction.destinationProfileId ? transaction.selectedProvider : paymentMethodProvider;

  if (transaction.destinationProfileId && paymentMethodProvider !== provider) {
    throw new Error("Selected payment method is not compatible with the resolved destination route");
  }

  const gateway = await prisma.gatewayConfig.findUniqueOrThrow({
    where: { provider },
    include: { health: true }
  });
  timer.mark("resolve-provider-and-gateway");

  assertProviderCanAcceptTraffic(provider, gateway);

  const existingMetadata = readTransactionMetadata(transaction.metadata);
  const acquired = await prisma.$transaction(
    async (tx) => {
      const updateResult = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: {
            in: ["PENDING", "REQUIRES_ACTION"]
          }
        },
        data: {
          status: "PROCESSING",
          selectedProvider: provider,
          metadata: {
            ...existingMetadata,
            selectedPaymentMethod: input.paymentMethod,
            hostedCheckout: true
          } as Prisma.InputJsonValue
        }
      });

      if (updateResult.count !== 1) {
        return false;
      }

      await tx.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: "checkout.confirmation_started",
          payload: { paymentMethod: input.paymentMethod, provider } as Prisma.InputJsonValue
        }
      });

      return true;
    },
    prismaTransactionOptions
  );
  timer.mark("acquire-processing-lock");

  if (!acquired) {
    return prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { organization: true, paymentAttempts: true }
    });
  }

  const chargeInput = {
    transactionId: transaction.id,
    provider,
    paymentMethod: input.paymentMethod
  };

  const { chargeQueue } = await import("../../lib/queues.js");
  let chargeQueued = false;

  if (chargeQueue) {
    const queueResult = await addQueueJobSafely("charge-queue", () =>
      chargeQueue.add("execute-charge", chargeInput, {
        jobId: `charge:${transaction.id}:${provider}`
      })
    );
    chargeQueued = queueResult.enqueued;
  }

  if (!chargeQueued) {
    console.warn(
      `[Checkout] Charge queue unavailable for ${transaction.id}; executing capture synchronously`
    );
    await executeAsynchronousCharge(chargeInput);
  }

  void recordCheckoutLatency(transaction.id, timer.snapshot());

  return prisma.transaction.findUniqueOrThrow({
    where: { id: transaction.id },
    include: { organization: true, paymentAttempts: true }
  });
}

export async function executeAsynchronousCharge(input: {
  transactionId: string;
  provider: GatewayProvider;
  paymentMethod: PaymentMethodId;
}) {
  const timer = new LatencyTimer();
  
  const transaction = await prisma.transaction.findUniqueOrThrow({
    where: { id: input.transactionId },
    include: { organization: true }
  });

  const gateway = await prisma.gatewayConfig.findUniqueOrThrow({
    where: { provider: input.provider },
    include: { health: true }
  });

  const adapter = getGatewayAdapter(input.provider);
  let result;

  try {
    assertProviderCanAcceptTraffic(input.provider, gateway);

    result = await adapter.charge({
      transactionId: transaction.id,
      amount: Number(transaction.grossAmount),
      currency: transaction.currency,
      customerPhone: transaction.customerPhone,
      customerEmail: transaction.customerEmail,
      customerName: transaction.customerName,
      externalReference: transaction.externalReference,
      paymentMethod: input.paymentMethod,
      phase: "capture"
    });
    timer.mark("provider-capture");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway capture request failed";

    await prisma.$transaction(
      async (tx) => {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "FAILED",
          failureReason: message
          }
        });

        await tx.transactionEvent.create({
          data: {
            transactionId: transaction.id,
            eventType: "gateway.capture_failed",
            payload: { message } as Prisma.InputJsonValue
          }
        });

        await finalizeSettlementsForTransaction(tx, {
          transactionId: transaction.id,
          status: "FAILED",
          orchestrationMode: transaction.orchestrationMode,
          settlementStrategy: transaction.settlementStrategy
        });
      },
      prismaTransactionOptions
    );

    const { maybeFinalizeCreditPurchaseFromTransaction } = await import("../credits/credits.service.js");
    await maybeFinalizeCreditPurchaseFromTransaction({
      id: transaction.id,
      status: "FAILED",
      metadata: transaction.metadata,
      settlementAmount: transaction.settlementAmount,
      failureReason: message
    });

    const { maybeFinalizeRecipientVerificationFromTransaction } = await import("../destination-profiles/destination-profiles.service.js");
    await maybeFinalizeRecipientVerificationFromTransaction({
      id: transaction.id,
      appId: transaction.appId,
      status: "FAILED",
      metadata: transaction.metadata,
      failureReason: message
    });

    throw new Error(message);
  }

  const nextStatus: TransactionStatus =
    result.status === "FAILED" ? "FAILED" : result.status === "SUCCESS" ? "SUCCEEDED" : "PROCESSING";
  const failureReason = result.status === "FAILED" ? extractGatewayFailureReason(result.raw) : null;

  await withTransientDbRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          await tx.paymentAttempt.create({
            data: {
              transactionId: transaction.id,
              gatewayConfigId: gateway.id,
              status:
                result.status === "FAILED"
                  ? "FAILED"
                  : result.status === "SUCCESS"
                    ? "SUCCESS"
                    : "PENDING",
              gatewayReference: result.providerReference,
              requestPayload: {
                paymentMethod: input.paymentMethod,
                provider: input.provider,
                phase: "capture"
              },
              responsePayload: result.raw as Prisma.InputJsonValue
            }
          });

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: nextStatus,
              selectedProvider: input.provider,
              failureReason
            }
          });

          await tx.transactionEvent.createMany({
            data: [
              {
                transactionId: transaction.id,
                eventType: "gateway.capture_initiated",
                payload: result.raw as Prisma.InputJsonValue
              },
              {
                transactionId: transaction.id,
                eventType: `transaction.${nextStatus.toLowerCase()}`,
                payload: {
                  providerReference: result.providerReference,
                  paymentMethod: input.paymentMethod
                } as Prisma.InputJsonValue
              }
            ]
          });

          await finalizeSettlementsForTransaction(tx, {
            transactionId: transaction.id,
            status: nextStatus,
            orchestrationMode: transaction.orchestrationMode,
            settlementStrategy: transaction.settlementStrategy
          });

          if (nextStatus === "SUCCEEDED") {
            await recordPlatformFeeCapture(tx, {
              id: transaction.id,
              status: nextStatus,
              currency: transaction.currency,
              platformFeeAmount: transaction.platformFeeAmount,
              externalReference: transaction.externalReference,
              selectedProvider: input.provider,
              appId: transaction.appId,
              organizationId: transaction.organizationId
            });
          }

          if (
            nextStatus === "SUCCEEDED" &&
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
                provider: input.provider,
                status: "PENDING",
                idempotencyKey: `payout:${transaction.id}:${transaction.destinationProfileId ?? "none"}`,
                requestPayload: {
                  provider: input.provider,
                  paymentMethod: input.paymentMethod
                }
              }
            });
          }
        },
        prismaTransactionOptions
      ),
    "Persist checkout capture result"
  );
  timer.mark("persist-capture-result");

  await prisma.auditLog.create({
    data: {
      actorType: "CHECKOUT_SESSION",
      action: "checkout.confirmed",
      entityType: "Transaction",
      entityId: transaction.id,
      payload: {
        paymentMethod: input.paymentMethod,
        provider: input.provider,
        status: nextStatus
      }
    }
  });
  timer.mark("persist-checkout-audit");

  if (webhookQueue) {
    const queue = webhookQueue;
    const eventType = `transaction.${nextStatus.toLowerCase()}`;
    await safeQueueAdd("webhook-queue", () =>
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
  }

  if (nextStatus === "PROCESSING" && retryQueue) {
    const queue = retryQueue;
    await safeQueueAdd("retry-queue", () =>
      queue.add(
        "retry-transaction",
        {
          transactionId: transaction.id,
          provider: input.provider
        },
        {
          jobId: `retry:${transaction.id}:${input.provider}`
        }
      )
    );
  }

  if (nextStatus === "SUCCEEDED" || nextStatus === "FAILED") {
    const { maybeFinalizeCreditPurchaseFromTransaction } = await import("../credits/credits.service.js");
    await maybeFinalizeCreditPurchaseFromTransaction({
      id: transaction.id,
      status: nextStatus,
      metadata: transaction.metadata,
      settlementAmount: transaction.settlementAmount,
      failureReason
    });

    const { maybeFinalizeRecipientVerificationFromTransaction } = await import("../destination-profiles/destination-profiles.service.js");
    await maybeFinalizeRecipientVerificationFromTransaction({
      id: transaction.id,
      appId: transaction.appId,
      status: nextStatus,
      metadata: transaction.metadata,
      failureReason
    });
  }

  await prisma.transactionEvent.create({
    data: {
      transactionId: transaction.id,
      eventType: "performance.charge_worker",
      payload: timer.snapshot() as Prisma.InputJsonValue
    }
  }).catch(() => {});

  return prisma.transaction.findUniqueOrThrow({
    where: { id: transaction.id },
    include: { organization: true, paymentAttempts: true }
  });
}

async function recordCheckoutLatency(transactionId: string, timing: ReturnType<LatencyTimer["snapshot"]>) {
  await prisma.transactionEvent
    .create({
      data: {
        transactionId,
        eventType: "performance.checkout_confirm",
        payload: timing as Prisma.InputJsonValue
      }
    })
    .catch((error) => {
      console.warn(`[Performance] Unable to record checkout latency: ${error instanceof Error ? error.message : error}`);
    });
}

async function withTransientDbRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientPrismaError(error) || attempt === 6) {
        throw error;
      }

      const delayMs = Math.min(1_000 * attempt, 5_000);
      console.warn(`[Checkout] ${label} failed transiently (attempt ${attempt}/6). Retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function isTransientPrismaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1000", "P1001", "P1002", "P2024", "P2028"].includes(error.code)
  );
}

function extractGatewayFailureReason(raw: Record<string, unknown>) {
  const candidate =
    readString(raw.message) ??
    readString(raw.error) ??
    readString(raw.reason) ??
    readString(raw.status_message) ??
    readString(raw.statusMessage);

  if (!candidate) {
    return "Payment authorization failed";
  }

  return candidate.replace(/\s+/g, " ").trim().slice(0, 240);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function safeQueueAdd(label: string, enqueue: () => Promise<unknown>) {
  const result = await addQueueJobSafely(label, enqueue);
  if (!result.enqueued) {
    console.warn(`[Checkout] ${label} enqueue skipped after payment state persisted: ${result.reason}`);
  }
}
