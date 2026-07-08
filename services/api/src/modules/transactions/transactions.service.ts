import { Prisma, type GatewayProvider, type OrchestrationMode } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { parseIpAddress } from "../../utils/http.js";
import { normalizePhoneNumber } from "../../utils/phone.js";
import { LatencyTimer } from "../../utils/performance.js";
import { addQueueJobSafely, retryQueue, webhookQueue } from "../../lib/queues.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import { calculateFees } from "../fees/fees.service.js";
import {
  buildFeeBreakdownMetadata,
  resolvePlatformFeeInputs
} from "../fees/fee-rule.resolver.js";
import {
  buildSettlementBreakdown,
  finalizeSettlementsForTransaction,
  settlementStatusForTransaction
} from "../settlements/settlements.service.js";
import {
  buildHostedCheckoutUrl,
  createCheckoutSessionToken
} from "../checkout/checkout.service.js";
import {
  buildDestinationSnapshot,
  resolveOrchestrationRoute
} from "../orchestration/router.service.js";
import {
  consumeOrchestrationMetering
} from "../orchestration/metering.service.js";
import { isCreditPurchaseTransaction } from "../credits/credits.service.js";
import { assertProviderCanAcceptTraffic } from "../providers/provider-registry.js";
import { recordPlatformFeeCapture } from "../treasury/treasury.service.js";

const SHORT_ROUTING_CACHE_TTL_MS = 5_000;
const ROUTING_CACHE_TTL_MS = 30_000;
const routingDependencyCache = new Map<string, { expiresAt: number; value: unknown }>();
type AuthenticatedAppProfile = Prisma.AppGetPayload<{
  include: {
    organization: true;
    providerAccesses: true;
    capabilities: true;
  };
}>;

export async function createTransaction(input: {
  appId: string;
  organizationId: string;
  idempotencyKey: string;
  externalReference: string;
  amount: number;
  currency: string;
  provider: GatewayProvider;
  externalRecipientId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  deferCapture?: boolean;
  appProfile?: AuthenticatedAppProfile;
}) {
  const timer = new LatencyTimer();
  const customerPhone = normalizePhoneNumber(input.customerPhone);
  const [appProfile, existing] = await Promise.all([
    input.appProfile ??
      prisma.app.findUniqueOrThrow({
        where: { id: input.appId },
        include: {
          organization: true,
          providerAccesses: true,
          capabilities: true
        }
      }),
    prisma.transaction.findUnique({
      where: {
        appId_idempotencyKey: {
          appId: input.appId,
          idempotencyKey: input.idempotencyKey
        }
      },
      include: {
        paymentAttempts: true,
        settlements: true
      }
    })
  ]);
  timer.mark("load-app-and-idempotency");

  if (appProfile.status !== "ACTIVE") {
    throw new Error("Application is suspended and cannot initiate payments");
  }

  const payinCapability = appProfile.capabilities.find((capability) => capability.capability === "PAYIN");
  if (payinCapability && !payinCapability.isEnabled) {
    throw new Error("Application pay-in capability is disabled");
  }

  if (existing) {
    return existing;
  }

  const route = await resolveOrchestrationRoute({
    appId: input.appId,
    requestedProvider: input.provider,
    externalRecipientId: input.externalRecipientId
  });
  timer.mark("resolve-route");

  const isCreditPurchase = isCreditPurchaseTransaction(input.metadata);
  const isRecipientVerification = isRecipientVerificationTransaction(input.metadata);
  const shouldMeter = !isCreditPurchase && !isRecipientVerification && shouldMeterTransaction(appProfile, route.mode);

  const appProviderAccess = appProfile.providerAccesses.find((provider) => provider.provider === route.provider);
  if (appProviderAccess && !appProviderAccess.isEnabled) {
    throw new Error(`Application access to ${route.provider} is disabled`);
  }

  const [organizationProviderAccess, gateway, feeRule, destination] = await Promise.all([
    getCachedRoutingDependency(
      `organization-provider-access:${input.organizationId}:${route.provider}`,
      SHORT_ROUTING_CACHE_TTL_MS,
      () =>
        prisma.organizationProviderAccess.findUnique({
          where: {
            organizationId_provider: {
              organizationId: input.organizationId,
              provider: route.provider
            }
          }
        })
    ),
    getCachedRoutingDependency(`gateway:${route.provider}`, SHORT_ROUTING_CACHE_TTL_MS, () =>
      prisma.gatewayConfig.findUniqueOrThrow({
        where: { provider: route.provider },
        include: { health: true }
      })
    ),
    getCachedRoutingDependency(`fee-rule:${input.organizationId}`, ROUTING_CACHE_TTL_MS, () =>
      prisma.feeRule.findFirst({
        where: { organizationId: input.organizationId, isActive: true },
        include: {
          ranges: {
            orderBy: { sortOrder: "asc" }
          }
        },
        orderBy: { createdAt: "desc" }
      })
    ),
    getCachedRoutingDependency(`default-payout-destination:${input.organizationId}`, ROUTING_CACHE_TTL_MS, () =>
      prisma.payoutDestination.findFirst({
        where: {
          organizationId: input.organizationId,
          isDefault: true
        }
      })
    )
  ]);
  timer.mark("load-routing-dependencies");

  if (organizationProviderAccess && !organizationProviderAccess.isEnabled) {
    throw new Error(`Organization access to ${route.provider} is disabled`);
  }

  assertProviderCanAcceptTraffic(route.provider, gateway);

  const gatewayMetadata = asRecord(gateway.metadata);
  const platformFeeInputs = resolvePlatformFeeInputs(feeRule, input.amount);
  const fees = calculateFees({
    baseAmount: input.amount,
    currency: input.currency,
    flatAmount: platformFeeInputs.flatAmount,
    percentageRate: platformFeeInputs.percentageRate,
    gatewayFlatAmount: asNumber(gatewayMetadata.providerFeeFlatAmount),
    gatewayPercentageRate: asNumber(gatewayMetadata.providerFeePercentageRate)
  });

  const settlement = buildSettlementBreakdown({
    amount: input.amount,
    grossAmount: fees.grossAmount,
    gatewayFeeAmount: fees.gatewayFeeAmount,
    platformFeeAmount: fees.platformFeeAmount
  });
  const destinationSnapshot = buildDestinationSnapshot(route.destinationProfile);
  const meteringChargeAmount = shouldMeter
    ? calculateCreditMeteringChargeAmount({
        platformFeeAmount: fees.platformFeeAmount,
        gatewayFeeAmount: fees.gatewayFeeAmount,
        amount: input.amount,
        currency: input.currency,
        gatewayMetadata,
        route
      })
    : 0;
  timer.mark("calculate-fees-and-settlement");

  const deferCapture = input.deferCapture ?? true;
  const checkoutSessionToken = deferCapture ? createCheckoutSessionToken() : undefined;
  const transactionMetadata = {
    ...(input.metadata ?? {}),
    feeBreakdown: buildFeeBreakdownMetadata(
      input.amount,
      input.currency,
      platformFeeInputs,
      fees,
      settlement.settlementAmount
    ),
    ...(deferCapture
      ? {
          hostedCheckout: true,
          checkoutSessionToken
        }
      : {})
  };

  const transaction = await createTransactionRecord({
    appId: input.appId,
    organizationId: input.organizationId,
    destinationProfileId: route.destinationProfile?.id,
    externalRecipientId: route.externalRecipientId,
    orchestrationMode: route.mode,
    settlementStrategy: route.settlementStrategy,
    externalReference: input.externalReference,
    idempotencyKey: input.idempotencyKey,
    currency: input.currency,
    amount: input.amount.toFixed(2),
    grossAmount: fees.grossAmount.toFixed(2),
    gatewayFeeAmount: fees.gatewayFeeAmount.toFixed(2),
    platformFeeAmount: fees.platformFeeAmount.toFixed(2),
    netAmount: settlement.netAmount.toFixed(2),
    settlementAmount: settlement.settlementAmount.toFixed(2),
    settlementDestinationId: route.mode === "PLATFORM_REVENUE" ? destination?.id : undefined,
    status: deferCapture ? "PENDING" : "PROCESSING",
    selectedProvider: route.provider,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone,
    metadata: transactionMetadata as Prisma.InputJsonValue,
    ipAddress: parseIpAddress(input.ipAddress)
  });
  timer.mark("create-transaction-record");

  if (shouldMeter && meteringChargeAmount > 0) {
    await consumeOrchestrationMetering({
      appId: input.appId,
      transactionId: transaction.id,
      eventType: "PAYMENT_INTENT_INITIALIZED",
      feeAlignedAmount: meteringChargeAmount,
      metadata: {
        mode: route.mode,
        settlementStrategy: route.settlementStrategy,
        provider: route.provider,
        externalRecipientId: route.externalRecipientId,
        baseAmount: input.amount,
        platformFeeAmount: fees.platformFeeAmount,
        gatewayFeeAmount: fees.gatewayFeeAmount,
        creditMeteringChargeAmount: meteringChargeAmount,
        billingBasis: "configured_transaction_cost"
      }
    });
    timer.mark("consume-metering");
  }


  if (deferCapture) {
    const checkoutUrl = buildHostedCheckoutUrl(transaction.id, checkoutSessionToken as string);
    const settlementRecord = await prisma.settlement.create({
      data: {
        transactionId: transaction.id,
        organizationId: input.organizationId,
        payoutDestinationId: route.mode === "PLATFORM_REVENUE" ? destination?.id : undefined,
        grossAmount: fees.grossAmount.toFixed(2),
        gatewayFeeAmount: fees.gatewayFeeAmount.toFixed(2),
        platformFeeAmount: fees.platformFeeAmount.toFixed(2),
        settlementAmount: settlement.settlementAmount.toFixed(2),
        destinationSnapshot:
          route.mode === "MULTI_TENANT"
            ? (destinationSnapshot as Prisma.InputJsonValue)
            : destination
              ? {
                  type: destination.destinationType,
                  ref: destination.destinationRef
                }
              : undefined
      }
    });
    timer.mark("persist-initial-settlement");

    void recordCheckoutSessionSideEffects({
      transactionId: transaction.id,
      appId: input.appId,
      externalReference: input.externalReference,
      provider: route.provider,
      checkoutUrl
    });

    void recordTransactionLatency(transaction.id, "performance.transaction_initialize", timer.snapshot());

    return {
      ...transaction,
      paymentAttempts: [],
      settlements: [settlementRecord],
      organization: appProfile.organization
    };
  }

  const adapter = getGatewayAdapter(route.provider);
  const result = await adapter.charge({
    transactionId: transaction.id,
    amount: fees.grossAmount,
    currency: input.currency,
    customerPhone,
    customerEmail: input.customerEmail,
    externalReference: input.externalReference
  });
  timer.mark("provider-charge");

  const nextStatus =
    result.status === "FAILED" ? "FAILED" : result.status === "SUCCESS" ? "SUCCEEDED" : "PROCESSING";

  await prisma.$transaction([
    prisma.paymentAttempt.create({
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
          amount: fees.grossAmount,
          currency: input.currency
        },
        responsePayload: result.raw as Prisma.InputJsonValue
      }
    }),
    prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: nextStatus,
        failureReason: result.status === "FAILED" ? "Gateway returned failure status" : null
      }
    }),
    prisma.transactionEvent.createMany({
      data: [
        {
          transactionId: transaction.id,
          eventType: "transaction.created",
          payload: { status: "PROCESSING" }
        },
        {
          transactionId: transaction.id,
          eventType: "gateway.charge_initiated",
          payload: result.raw as Prisma.InputJsonValue
        },
        {
          transactionId: transaction.id,
          eventType: `transaction.${nextStatus.toLowerCase()}`,
          payload: {
            providerReference: result.providerReference
          } as Prisma.InputJsonValue
        }
      ]
    }),
    prisma.auditLog.create({
      data: {
        actorType: "APP",
        actorId: input.appId,
        action: "transaction.initialized",
        entityType: "Transaction",
        entityId: transaction.id,
        payload: {
          externalReference: input.externalReference,
          provider: route.provider,
          status: nextStatus,
          amount: input.amount,
          grossAmount: fees.grossAmount,
          gatewayFeeAmount: fees.gatewayFeeAmount,
          platformFeeAmount: fees.platformFeeAmount
        }
      }
    }),
    prisma.settlement.create({
      data: {
        transactionId: transaction.id,
        organizationId: input.organizationId,
        payoutDestinationId: route.mode === "PLATFORM_REVENUE" ? destination?.id : undefined,
        grossAmount: fees.grossAmount.toFixed(2),
        gatewayFeeAmount: fees.gatewayFeeAmount.toFixed(2),
        platformFeeAmount: fees.platformFeeAmount.toFixed(2),
        settlementAmount: settlement.settlementAmount.toFixed(2),
        status:
          settlementStatusForTransaction(nextStatus, {
            orchestrationMode: route.mode,
            settlementStrategy: route.settlementStrategy
          }) ?? "PENDING",
        destinationSnapshot:
          route.mode === "MULTI_TENANT"
            ? (destinationSnapshot as Prisma.InputJsonValue)
            : destination
              ? {
                  type: destination.destinationType,
                  ref: destination.destinationRef
                } as Prisma.InputJsonValue
              : undefined
      }
    })
  ]);
  timer.mark("persist-post-charge-batch");

  if (nextStatus === "SUCCEEDED") {
    await prisma.$transaction(
      (tx) =>
        recordPlatformFeeCapture(tx, {
          id: transaction.id,
          status: nextStatus,
          currency: input.currency,
          platformFeeAmount: new Prisma.Decimal(fees.platformFeeAmount),
          externalReference: input.externalReference,
          selectedProvider: route.provider,
          appId: input.appId,
          organizationId: input.organizationId
        }),
      prismaTransactionOptions
    );
    timer.mark("capture-treasury-platform-fee");
  }

  if (nextStatus === "SUCCEEDED" && route.mode === "MULTI_TENANT" && route.settlementStrategy === "TWO_STEP_MIRROR") {
    await prisma.payoutCoordination.upsert({
      where: {
        idempotencyKey: `payout:${transaction.id}:${route.destinationProfile?.id ?? "none"}`
      },
      update: {},
      create: {
        transactionId: transaction.id,
        destinationProfileId: route.destinationProfile?.id,
        provider: route.provider,
        status: "PENDING",
        idempotencyKey: `payout:${transaction.id}:${route.destinationProfile?.id ?? "none"}`,
        requestPayload: destinationSnapshot as Prisma.InputJsonValue
      }
    });
  }

  if (isCreditPurchase && (nextStatus === "SUCCEEDED" || nextStatus === "FAILED")) {
    const { maybeFinalizeCreditPurchaseFromTransaction } = await import("../credits/credits.service.js");
    await maybeFinalizeCreditPurchaseFromTransaction({
      id: transaction.id,
      status: nextStatus,
      metadata: transactionMetadata,
      settlementAmount: settlement.settlementAmount,
      failureReason: nextStatus === "FAILED" ? "Gateway returned failure status" : null
    });
  }

  if (isRecipientVerification && (nextStatus === "SUCCEEDED" || nextStatus === "FAILED")) {
    const { maybeFinalizeRecipientVerificationFromTransaction } = await import("../destination-profiles/destination-profiles.service.js");
    await maybeFinalizeRecipientVerificationFromTransaction({
      id: transaction.id,
      appId: transaction.appId,
      status: nextStatus,
      metadata: transactionMetadata,
      failureReason: nextStatus === "FAILED" ? "Gateway returned failure status" : null
    });
  }

  if (retryQueue) {
    const queue = retryQueue;
    const retryResult = await addQueueJobSafely("retry-queue", () =>
      queue.add(
        "retry-transaction",
        {
          transactionId: transaction.id,
          provider: route.provider
        },
        {
          jobId: `retry:${transaction.id}:${route.provider}`
        }
      )
    );

    if (!retryResult.enqueued) {
      await prisma.retryJob.create({
        data: {
          transactionId: transaction.id,
          queueName: "retry-queue",
          reason: `Retry queue unavailable for ${route.provider}: ${retryResult.reason}`,
          status: "FAILED"
        }
      });
    }
  } else {
    await prisma.retryJob.create({
      data: {
        transactionId: transaction.id,
        queueName: "retry-queue",
        reason: `Retry queue unavailable for ${route.provider}`,
        status: "FAILED"
      }
    });
  }

  if (webhookQueue) {
    const queue = webhookQueue;
    const webhookResult = await addQueueJobSafely("webhook-queue", () =>
      queue.add(
        "dispatch-app-webhook",
        {
          transactionId: transaction.id,
          eventType: "transaction.created"
        },
        {
          jobId: `webhook:${transaction.id}:transaction.created`
        }
      )
    );

    if (!webhookResult.enqueued) {
      await prisma.retryJob.create({
        data: {
          transactionId: transaction.id,
          queueName: "webhook-queue",
          reason: `Webhook queue unavailable during dispatch: ${webhookResult.reason}`,
          status: "FAILED"
        }
      });
    }
  } else {
    await prisma.retryJob.create({
      data: {
        transactionId: transaction.id,
        queueName: "webhook-queue",
        reason: "Webhook queue unavailable during dispatch",
        status: "FAILED"
      }
    });
  }

  void recordTransactionLatency(transaction.id, "performance.transaction_initialize", timer.snapshot());

  return prisma.transaction.findUniqueOrThrow({
    where: { id: transaction.id },
    include: {
      paymentAttempts: true,
      settlements: true
    }
  });
}

async function recordTransactionLatency(
  transactionId: string,
  eventType: string,
  timing: ReturnType<LatencyTimer["snapshot"]>
) {
  await prisma.transactionEvent
    .create({
      data: {
        transactionId,
        eventType,
        payload: timing as Prisma.InputJsonValue
      }
    })
    .catch((error) => {
      console.warn(`[Performance] Unable to record ${eventType}: ${error instanceof Error ? error.message : error}`);
    });
}

async function recordCheckoutSessionSideEffects(input: {
  transactionId: string;
  appId: string;
  externalReference: string;
  provider: GatewayProvider;
  checkoutUrl: string;
}) {
  await prisma.$transaction([
    prisma.transactionEvent.create({
      data: {
        transactionId: input.transactionId,
        eventType: "checkout.session_created",
        payload: {
          status: "PENDING",
          checkoutUrl: input.checkoutUrl
        }
      }
    }),
    prisma.auditLog.create({
      data: {
        actorType: "APP",
        actorId: input.appId,
        action: "transaction.checkout_initialized",
        entityType: "Transaction",
        entityId: input.transactionId,
        payload: {
          externalReference: input.externalReference,
          provider: input.provider,
          status: "PENDING",
          deferCapture: true
        }
      }
    })
  ]).catch((error) => {
    console.warn(
      `[Transaction] Unable to record checkout session side effects: ${error instanceof Error ? error.message : error}`
    );
  });
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

async function getCachedRoutingDependency<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
  const now = Date.now();
  const cached = routingDependencyCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await loader();
  routingDependencyCache.set(key, {
    value,
    expiresAt: now + ttlMs
  });

  return value;
}

function shouldMeterTransaction(
  app: { mode1MeteringEnabled: boolean; mode2MeteringEnabled: boolean },
  mode: OrchestrationMode
) {
  return mode === "MULTI_TENANT" ? app.mode2MeteringEnabled : app.mode1MeteringEnabled;
}

function calculateCreditMeteringChargeAmount(input: {
  platformFeeAmount: number;
  gatewayFeeAmount: number;
  amount: number;
  currency: string;
  gatewayMetadata: Record<string, unknown>;
  route: {
    mode: OrchestrationMode;
    settlementStrategy: string;
  };
}) {
  const payoutFeeAmount =
    input.route.mode === "MULTI_TENANT" && input.route.settlementStrategy === "TWO_STEP_MIRROR"
      ? calculateProviderPayoutCost({
          amount: input.amount,
          currency: input.currency,
          metadata: input.gatewayMetadata
        })
      : 0;

  return normalizeCurrencyAmount(
    input.platformFeeAmount + input.gatewayFeeAmount + payoutFeeAmount,
    input.currency
  );
}

function calculateProviderPayoutCost(input: {
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
}) {
  const flat = asNumber(input.metadata.providerPayoutFeeFlatAmount);
  const percentage = asNumber(input.metadata.providerPayoutFeePercentageRate);
  return normalizeCurrencyAmount(flat + (input.amount * percentage) / 100, input.currency);
}

function normalizeCurrencyAmount(value: number, currency: string) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return zeroDecimalCurrencies.has(currency.toUpperCase()) ? Math.ceil(value) : Number(value.toFixed(2));
}

const zeroDecimalCurrencies = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

function asNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getTransactionById(id: string) {
  return prisma.transaction.findUnique({
    where: { id },
    include: {
      paymentAttempts: true,
      events: true,
      settlements: true,
      organization: true
    }
  });
}

export async function listTransactions() {
  return prisma.transaction.findMany({
    include: {
      app: true,
      organization: true
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

export async function getDashboardSummary() {
  const [transactions, failedTransactions, pendingSettlements, apps, gatewayHealth] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.count({ where: { status: "FAILED" } }),
    prisma.settlement.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.app.count(),
    prisma.gatewayHealth.findMany({ orderBy: { provider: "asc" } })
  ]);

  return {
    metrics: {
      transactions,
      failedTransactions,
      pendingSettlements,
      apps
    },
    gatewayHealth
  };
}

export async function markTransactionUnderReview(transactionId: string, note?: string) {
  const transaction = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status: "UNDER_REVIEW",
      failureReason: note ?? undefined
    },
    include: {
      app: true,
      organization: true
    }
  });

  await prisma.transactionEvent.create({
    data: {
      transactionId,
      eventType: "transaction.marked_under_review",
      payload: {
        note
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorType: "INTERNAL_SERVICE",
      action: "transaction.marked_under_review",
      entityType: "Transaction",
      entityId: transactionId,
      payload: {
        note
      }
    }
  });

  return transaction;
}

export async function expireStalePendingCheckoutTransactions(input?: {
  olderThanMinutes?: number;
  limit?: number;
  dryRun?: boolean;
  reason?: string;
}) {
  const olderThanMinutes = Math.max(input?.olderThanMinutes ?? 12 * 60, 30);
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const reason =
    input?.reason ?? `Checkout session expired after ${olderThanMinutes} minutes without provider authorization`;

  const candidates = await prisma.transaction.findMany({
    where: {
      status: "PENDING",
      updatedAt: { lt: cutoff },
      paymentAttempts: { none: {} },
      events: {
        some: {
          eventType: "checkout.session_created"
        }
      }
    },
    select: {
      id: true,
      externalReference: true,
      status: true,
      orchestrationMode: true,
      settlementStrategy: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: { updatedAt: "asc" },
    take: limit
  });

  if (input?.dryRun) {
    return {
      dryRun: true,
      cutoff,
      candidates
    };
  }

  let expired = 0;

  for (const transaction of candidates) {
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: "PENDING",
          paymentAttempts: { none: {} }
        },
        data: {
          status: "EXPIRED",
          failureReason: reason
        }
      });

      if (updateResult.count !== 1) {
        return;
      }

      await finalizeSettlementsForTransaction(tx, {
        transactionId: transaction.id,
        status: "EXPIRED",
        orchestrationMode: transaction.orchestrationMode,
        settlementStrategy: transaction.settlementStrategy
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: "transaction.expired",
          payload: {
            previousStatus: transaction.status,
            reason,
            cutoff
          } as Prisma.InputJsonValue
        }
      });

      await tx.retryJob.create({
        data: {
          transactionId: transaction.id,
          queueName: "stale-pending-expiry",
          reason,
          status: "SUCCEEDED",
          attempts: 1,
          payload: {
            previousStatus: transaction.status,
            cutoff
          } as Prisma.InputJsonValue
        }
      });

      expired += 1;
    });
  }

  return {
    dryRun: false,
    cutoff,
    expired,
    inspected: candidates.length
  };
}

function isRecipientVerificationTransaction(metadata?: Record<string, unknown> | null) {
  return metadata?.__flowpay_recipient_verification === true;
}

export async function enqueueTransactionRetry(transactionId: string, reason?: string) {
  const transaction = await prisma.transaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: {
      app: true,
      organization: true
    }
  });

  const retryJob = await prisma.retryJob.create({
    data: {
      transactionId,
      queueName: "retry-queue",
      reason: reason ?? "Manual retry requested from Flow Admin",
      status: "QUEUED",
      nextRunAt: new Date()
    }
  });

  if (retryQueue) {
    const queue = retryQueue;
    const queueResult = await addQueueJobSafely("retry-queue", () =>
      queue.add(
        "retry-transaction",
        {
          transactionId,
          provider: transaction.selectedProvider,
          manual: true
        },
        {
          jobId: `retry:${transactionId}:${transaction.selectedProvider}:manual:${retryJob.id}`
        }
      )
    );

    if (!queueResult.enqueued) {
      await prisma.retryJob.update({
        where: { id: retryJob.id },
        data: {
          status: "FAILED",
          reason: `Manual retry queue unavailable: ${queueResult.reason}`
        }
      });
    }
  }

  await prisma.transactionEvent.create({
    data: {
      transactionId,
      eventType: "transaction.retry_requested",
      payload: {
        retryJobId: retryJob.id,
        reason: retryJob.reason
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorType: "INTERNAL_SERVICE",
      action: "transaction.retry_requested",
      entityType: "Transaction",
      entityId: transactionId,
      payload: {
        retryJobId: retryJob.id,
        reason: retryJob.reason
      }
    }
  });

  return {
    transaction,
    retryJob
  };
}

async function createTransactionRecord(data: Prisma.TransactionCreateInput | Prisma.TransactionUncheckedCreateInput) {
  try {
    return await prisma.transaction.create({ data });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const appId = "appId" in data ? data.appId : undefined;
      const idempotencyKey = "idempotencyKey" in data ? data.idempotencyKey : undefined;

      if (typeof appId === "string" && typeof idempotencyKey === "string") {
        return prisma.transaction.findUniqueOrThrow({
          where: {
            appId_idempotencyKey: {
              appId,
              idempotencyKey
            }
          }
        });
      }
    }

    throw error;
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
