import { Prisma, type GatewayProvider, type RevenuePayout, type RevenuePayoutStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import { addQueueJobSafely, webhookQueue } from "../../lib/queues.js";

const MAX_REVENUE_PAYOUT_ATTEMPTS = 6;
const reservingStatuses: RevenuePayoutStatus[] = ["PENDING", "PROCESSING", "SUCCEEDED"];
type RevenuePayoutBalanceReader = Pick<typeof prisma, "settlement" | "revenuePayout">;

export async function getRevenuePayoutBalance(input: {
  organizationId: string;
  appId?: string;
  currency: string;
}, db: RevenuePayoutBalanceReader = prisma) {
  const currency = input.currency.toUpperCase();
  const transactionWhere: Prisma.TransactionWhereInput = {
    orchestrationMode: "PLATFORM_REVENUE",
    status: "SUCCEEDED",
    currency,
    ...(input.appId ? { appId: input.appId } : {})
  };
  const revenuePayoutWhere: Prisma.RevenuePayoutWhereInput = {
    organizationId: input.organizationId,
    currency,
    status: { in: reservingStatuses },
    ...(input.appId
      ? {
          OR: [
            { appId: input.appId },
            {
              metadata: {
                path: ["appId"],
                equals: input.appId
              }
            }
          ]
        }
      : {})
  };

  const [settledPlatformRevenue, reservedPayouts] = await Promise.all([
    db.settlement.aggregate({
      where: {
        organizationId: input.organizationId,
        status: "SETTLED",
        transaction: transactionWhere
      },
      _sum: {
        settlementAmount: true
      }
    }),
    db.revenuePayout.aggregate({
      where: revenuePayoutWhere,
      _sum: {
        amount: true
      }
    })
  ]);

  const collected = Number(settledPlatformRevenue._sum.settlementAmount ?? 0);
  const reserved = Number(reservedPayouts._sum.amount ?? 0);

  return {
    organizationId: input.organizationId,
    appId: input.appId,
    currency,
    collected,
    reserved,
    available: Math.max(0, collected - reserved)
  };
}

export async function listRevenuePayouts(organizationId?: string) {
  return prisma.revenuePayout.findMany({
    where: organizationId ? { organizationId } : undefined,
    include: {
      organization: true,
      payoutDestination: true
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
}

export async function processDueRevenuePayouts(limit = 25) {
  const items = await prisma.revenuePayout.findMany({
    where: {
      attempts: { lt: MAX_REVENUE_PAYOUT_ATTEMPTS },
      OR: [
        { status: "PENDING", nextRunAt: null },
        { status: { in: ["PENDING", "FAILED"] }, nextRunAt: { lte: new Date() } }
      ]
    },
    select: { id: true },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });

  for (const item of items) {
    await processRevenuePayout(item.id);
  }

  const exhaustedItems = await prisma.revenuePayout.findMany({
    where: {
      status: "PENDING",
      attempts: { gte: MAX_REVENUE_PAYOUT_ATTEMPTS },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
    },
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }],
    take: limit
  });

  for (const item of exhaustedItems) {
    await markRevenuePayoutReviewRequired(
      item.id,
      "Provider accepted revenue payout but did not return a terminal confirmation after all retry attempts"
    );
  }
}

export async function createRevenuePayout(input: {
  organizationId: string;
  payoutDestinationId: string;
  provider: GatewayProvider;
  amount: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  if (input.amount <= 0) {
    throw new Error("Revenue payout amount must be positive");
  }

  const currency = input.currency.toUpperCase();
  const destination = await prisma.payoutDestination.findFirst({
    where: {
      id: input.payoutDestinationId,
      organizationId: input.organizationId
    }
  });

  if (!destination) {
    throw new Error("Payout destination was not found for this organization");
  }

  if (destination.currency.toUpperCase() !== currency) {
    throw new Error("Payout destination currency does not match payout currency");
  }

  const balance = await getRevenuePayoutBalance({
    organizationId: input.organizationId,
    currency
  });

  if (input.amount > balance.available) {
    throw new Error(
      `Insufficient settled revenue for payout. Available ${balance.available} ${currency}`
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const payout = await tx.revenuePayout.create({
        data: {
          organizationId: input.organizationId,
          payoutDestinationId: destination.id,
          provider: input.provider,
          amount: input.amount.toFixed(2),
          currency,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          requestPayload: {
            payoutDestinationId: destination.id,
            destinationType: destination.destinationType,
            destinationRef: maskPayoutTarget(destination.destinationRef)
          }
        },
        include: {
          organization: true,
          payoutDestination: true
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "INTERNAL_SERVICE",
          action: "revenue_payout.created",
          entityType: "RevenuePayout",
          entityId: payout.id,
          payload: {
            organizationId: payout.organizationId,
            amount: input.amount,
            currency,
            provider: input.provider,
            payoutDestinationId: destination.id
          }
        }
      });

      return payout;
    },
    prismaTransactionOptions
  );
}

export async function createAppRevenuePayout(input: {
  appId: string;
  organizationId: string;
  appProfile: {
    status: string;
    providerAccesses: Array<{ provider: GatewayProvider; isEnabled: boolean; runtimeMode?: unknown }>;
    capabilities: Array<{ capability: string; isEnabled: boolean }>;
  };
  idempotencyKey: string;
  amount: number;
  currency: string;
  reference: string;
  destinationProfileId?: string;
  externalRecipientId?: string;
  provider?: GatewayProvider;
  metadata?: Record<string, unknown>;
}) {
  if (input.appProfile.status !== "ACTIVE") {
    throw new Error("Application is suspended and cannot initiate payouts");
  }

  const payoutCapability = input.appProfile.capabilities.find((capability) => capability.capability === "PAYOUT");
  if (payoutCapability && !payoutCapability.isEnabled) {
    throw new Error("Application payout capability is disabled");
  }

  const appIdempotencyKey = `app-revenue-payout:${input.appId}:${input.idempotencyKey}`;
  const existing = await prisma.revenuePayout.findUnique({
    where: { idempotencyKey: appIdempotencyKey }
  });

  if (existing) {
    return {
      created: false,
      response: serializeAppRevenuePayoutResponse(existing)
    };
  }

  const destinationProfile = await prisma.destinationProfile.findFirst({
    where: buildDestinationProfileLookup(input)
  });

  if (!destinationProfile) {
    throw new Error("Destination profile was not found for this application");
  }

  if (destinationProfile.verificationStatus !== "VERIFIED") {
    throw new Error("Destination profile is not verified for payouts");
  }

  const currency = input.currency.toUpperCase();
  if (destinationProfile.regionalCurrency.toUpperCase() !== currency) {
    throw new Error("Destination profile currency does not match payout currency");
  }

  const provider = input.provider ?? destinationProfile.providerType;
  const appProviderAccess = input.appProfile.providerAccesses.find((access) => access.provider === provider);
  if (appProviderAccess && !appProviderAccess.isEnabled) {
    throw new Error(`Application access to ${provider} is disabled`);
  }
  const organizationProviderAccess = await prisma.organizationProviderAccess.findUnique({
    where: {
      organizationId_provider: {
        organizationId: input.organizationId,
        provider
      }
    }
  });

  if (organizationProviderAccess && !organizationProviderAccess.isEnabled) {
    throw new Error(`Organization access to ${provider} is disabled`);
  }

  const providerRuntimeMode =
    normalizeRuntimeMode(appProviderAccess?.runtimeMode) ?? normalizeRuntimeMode(organizationProviderAccess?.runtimeMode);

  const balance = await getRevenuePayoutBalance({
    organizationId: input.organizationId,
    appId: input.appId,
    currency
  });

  if (input.amount > balance.available) {
    throw new Error(`Insufficient settled Mode 1 revenue for payout. Available ${balance.available} ${currency}`);
  }

  const payout = await prisma.$transaction(
    async (tx) => {
      const created = await tx.revenuePayout.create({
        data: {
          organizationId: input.organizationId,
          appId: input.appId,
          payoutDestinationId: null,
          provider,
          amount: input.amount.toFixed(2),
          currency,
          idempotencyKey: appIdempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            source: "app_revenue_payout",
            appId: input.appId,
            externalReference: input.reference,
            providerRuntimeMode,
            destinationProfileId: destinationProfile.id,
            externalRecipientId: destinationProfile.externalRecipientId,
            payoutTargetMasked: maskPayoutTarget(destinationProfile.payoutTarget)
          } as Prisma.InputJsonValue,
          requestPayload: {
            reference: input.reference,
            amount: input.amount,
            currency,
            destinationProfileId: destinationProfile.id,
            externalRecipientId: destinationProfile.externalRecipientId,
            destinationType: "destination_profile",
            payoutTarget: maskPayoutTarget(destinationProfile.payoutTarget)
          } as Prisma.InputJsonValue
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "APP",
          actorId: input.appId,
          action: "app_revenue_payout.created",
          entityType: "RevenuePayout",
          entityId: created.id,
          payload: {
            reference: input.reference,
            amount: input.amount,
            currency,
            provider,
            destinationProfileId: destinationProfile.id,
            appId: input.appId,
            availableAppRevenueBeforePayout: balance.available
          } as Prisma.InputJsonValue
        }
      });

      return created;
    },
    prismaTransactionOptions
  );

  processRevenuePayout(payout.id).catch(() => undefined);

  return {
    created: true,
    response: serializeAppRevenuePayoutResponse(payout)
  };
}

export async function getAppRevenuePayoutStatus(input: {
  appId: string;
  organizationId: string;
  payoutId: string;
}) {
  const payout = await prisma.revenuePayout.findFirst({
    where: {
      id: input.payoutId,
      organizationId: input.organizationId,
      OR: [
        { appId: input.appId },
        {
          metadata: {
            path: ["appId"],
            equals: input.appId
          }
        }
      ]
    }
  });

  if (!payout) {
    return null;
  }

  return serializeAppRevenuePayoutResponse(payout);
}

export async function processRevenuePayout(id: string) {
  const payout = await prisma.revenuePayout.findUnique({
    where: { id },
    include: {
      payoutDestination: true,
      organization: true
    }
  });

  if (!payout) {
    throw new Error(`Revenue payout ${id} was not found`);
  }

  if (["PROCESSING", "SUCCEEDED", "CANCELLED"].includes(payout.status)) {
    return { processed: false, status: payout.status, skipped: true };
  }

  const payoutTarget = await resolveRevenuePayoutTarget(payout);
  if (!payoutTarget) {
    await failRevenuePayout(payout.id, "Payout destination is missing", {});
    await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "failed");
    return { processed: true, status: "FAILED" as RevenuePayoutStatus, reason: "Payout destination is missing" };
  }

  const adapter = getGatewayAdapter(payout.provider);
  if (!adapter.executePayout) {
    const reason = `${payout.provider} adapter does not support revenue payout execution`;
    await failRevenuePayout(payout.id, reason, { provider: payout.provider });
    await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "failed");
    return { processed: true, status: "FAILED" as RevenuePayoutStatus, reason };
  }

  const claimed = await prisma.revenuePayout.updateMany({
    where: {
      id: payout.id,
      status: { in: ["PENDING", "FAILED"] }
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      failureReason: null
    }
  });

  if (claimed.count !== 1) {
    return { processed: false, status: payout.status, skipped: true };
  }

  try {
    const existingProviderReference = readProviderReference(payout.responsePayload);
    const providerRuntimeMode = readProviderRuntimeMode(payout.metadata);
    const result =
      existingProviderReference && adapter.getTransactionStatus
        ? await adapter.getTransactionStatus(existingProviderReference, providerRuntimeMode)
        : await adapter.executePayout({
            transactionId: `revenue:${payout.id}`,
            payoutCoordinationId: payout.id,
            payoutTarget: payoutTarget.value,
            amount: Number(payout.amount),
            currency: payout.currency,
            idempotencyKey: payout.idempotencyKey,
            runtimeMode: providerRuntimeMode,
            metadata: {
              organizationId: payout.organizationId,
              appId: payout.appId,
              payoutDestinationId: payout.payoutDestinationId,
              destinationProfileId: payoutTarget.destinationProfileId,
              providerRuntimeMode,
              payoutType: isAppRevenuePayout(payout) ? "APP_PLATFORM_REVENUE_EXIT" : "PLATFORM_REVENUE_EXIT"
            }
          });

    const nextStatus = mapPayoutStatus(result.status);
    const attemptNumber = payout.attempts + 1;
    const pendingExhausted = nextStatus === "PENDING" && attemptNumber >= MAX_REVENUE_PAYOUT_ATTEMPTS;
    const reviewReason =
      "Provider accepted revenue payout but did not return a terminal confirmation after all retry attempts";

    await prisma.$transaction(
      async (tx) => {
        await tx.revenuePayout.update({
          where: { id: payout.id },
          data: {
            status: pendingExhausted ? "FAILED" : nextStatus,
            responsePayload: result.raw as Prisma.InputJsonValue,
            failureReason: pendingExhausted
              ? reviewReason
              : nextStatus === "FAILED"
                ? "Provider revenue payout execution failed"
                : null,
            nextRunAt: !pendingExhausted && nextStatus === "PENDING" ? nextRevenuePayoutAttemptAt(attemptNumber) : null
          }
        });

        await tx.auditLog.create({
          data: {
            actorType: "INTERNAL_SERVICE",
            action: "revenue_payout.processed",
            entityType: "RevenuePayout",
            entityId: payout.id,
            payload: {
              provider: payout.provider,
              providerReference: result.providerReference,
              status: pendingExhausted ? "UNDER_REVIEW" : nextStatus,
              destinationType: payoutTarget.type
            }
          }
        });

        if (pendingExhausted) {
          await tx.retryJob.create({
            data: {
              transactionId: null,
              queueName: "revenue-payout",
              reason: reviewReason,
              status: "FAILED",
              attempts: attemptNumber,
              payload: {
                revenuePayoutId: payout.id,
                provider: payout.provider,
                providerReference: result.providerReference,
                response: result.raw
              } as Prisma.InputJsonValue
            }
          });
        }
      },
      prismaTransactionOptions
    );

    if (pendingExhausted) {
      await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "review_required");
    } else if (nextStatus === "SUCCEEDED") {
      await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "success");
    } else if (nextStatus === "FAILED") {
      await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "failed");
    }

    return { processed: true, status: nextStatus, providerReference: result.providerReference };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const retryable = payout.attempts + 1 < MAX_REVENUE_PAYOUT_ATTEMPTS;

    await prisma.revenuePayout.update({
      where: { id: payout.id },
      data: {
        status: "FAILED",
        failureReason: reason,
        nextRunAt: retryable ? nextRevenuePayoutAttemptAt(payout.attempts + 1) : null,
        responsePayload: { error: reason }
      }
    });

    if (!retryable) {
      await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "failed");
    }

    return { processed: true, status: "FAILED" as RevenuePayoutStatus, reason };
  }
}

export async function processRevenuePayoutProviderWebhook(
  provider: GatewayProvider,
  payload: Record<string, unknown>
) {
  const providerReference = readProviderReference(payload);
  const externalReference = readExternalReference(payload);
  const mappedStatus = mapProviderPayloadPayoutStatus(payload);

  if (!providerReference && !externalReference) {
    return { processed: false, reason: "No revenue payout reference found in webhook payload" };
  }

  const payout = await findRevenuePayoutForProviderEvent({
    provider,
    providerReference,
    externalReference
  });

  if (!payout) {
    return { processed: false, reason: "Revenue payout not found for webhook payload" };
  }

  if (payout.status === mappedStatus) {
    return {
      processed: true,
      revenuePayoutId: payout.id,
      status: mappedStatus,
      deduplicated: true
    };
  }

  if (payout.status === "SUCCEEDED" && mappedStatus !== "SUCCEEDED") {
    return {
      processed: false,
      revenuePayoutId: payout.id,
      status: payout.status,
      reason: `Ignored revenue payout transition from terminal status ${payout.status}`
    };
  }

  const responsePayload = {
    ...asRecord(payout.responsePayload),
    providerReference: providerReference ?? readProviderReference(payout.responsePayload),
    webhook: payload
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.revenuePayout.update({
        where: { id: payout.id },
        data: {
          status: mappedStatus,
          responsePayload: responsePayload as Prisma.InputJsonValue,
          failureReason: mappedStatus === "FAILED" ? readFailureReason(payload) : null,
          nextRunAt: mappedStatus === "PENDING" ? payout.nextRunAt : null
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "GATEWAY",
          actorId: provider,
          action: "revenue_payout.gateway_webhook_processed",
          entityType: "RevenuePayout",
          entityId: payout.id,
          payload: {
            provider,
            providerReference,
            externalReference,
            mappedStatus
          } as Prisma.InputJsonValue
        }
      });
    },
    prismaTransactionOptions
  );

  if (mappedStatus === "SUCCEEDED") {
    await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "success");
  } else if (mappedStatus === "FAILED") {
    await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "failed");
  }

  return {
    processed: true,
    revenuePayoutId: payout.id,
    status: mappedStatus
  };
}

function mapPayoutStatus(status: "PENDING" | "SUCCESS" | "FAILED"): RevenuePayoutStatus {
  if (status === "SUCCESS") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

function nextRevenuePayoutAttemptAt(attempts: number) {
  return new Date(Date.now() + Math.min(attempts * 60_000, 15 * 60_000));
}

function readProviderReference(payload: unknown) {
  const data = asRecord(payload);
  const reference =
    data.transId ??
    data.providerReference ??
    data.reference ??
    data.transaction_id ??
    data.transactionId ??
    data.payment_token;
  return typeof reference === "string" && reference.trim() ? reference.trim() : null;
}

function readExternalReference(payload: Record<string, unknown>) {
  const reference =
    payload.externalId ??
    payload.external_id ??
    payload.externalReference ??
    payload.external_reference ??
    payload.order_id;
  return typeof reference === "string" && reference.trim() ? reference.trim() : null;
}

function mapProviderPayloadPayoutStatus(payload: Record<string, unknown>): RevenuePayoutStatus {
  const raw = String(payload.status ?? payload.payment_status ?? payload.transaction_status ?? payload.event ?? "").toUpperCase();
  if (raw.includes("SUCCESS") || raw.includes("COMPLETED") || raw.includes("PAID")) return "SUCCEEDED";
  if (raw.includes("FAIL") || raw.includes("CANCEL") || raw.includes("REJECT") || raw.includes("EXPIRED")) return "FAILED";
  return "PENDING";
}

function readFailureReason(payload: Record<string, unknown>) {
  const reason = payload.reason ?? payload.message ?? payload.error ?? payload.description;
  return typeof reason === "string" && reason.trim() ? reason.trim() : "Gateway reported payout failure";
}

async function findRevenuePayoutForProviderEvent(input: {
  provider: GatewayProvider;
  providerReference: string | null;
  externalReference: string | null;
}) {
  const lookupClauses: Prisma.RevenuePayoutWhereInput[] = [];

  if (input.externalReference) {
    lookupClauses.push({ idempotencyKey: input.externalReference });
    lookupClauses.push({ metadata: { path: ["externalReference"], equals: input.externalReference } });
  }

  if (input.providerReference) {
    lookupClauses.push({ responsePayload: { path: ["transId"], equals: input.providerReference } });
    lookupClauses.push({ responsePayload: { path: ["providerReference"], equals: input.providerReference } });
    lookupClauses.push({ responsePayload: { path: ["reference"], equals: input.providerReference } });
  }

  if (lookupClauses.length === 0) {
    return null;
  }

  return prisma.revenuePayout.findFirst({
    where: {
      provider: input.provider,
      status: { in: ["PENDING", "PROCESSING", "FAILED", "SUCCEEDED"] },
      OR: lookupClauses
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function markRevenuePayoutReviewRequired(id: string, reason: string) {
  const payout = await prisma.revenuePayout.findUnique({
    where: { id }
  });

  if (!payout || payout.status !== "PENDING" || payout.attempts < MAX_REVENUE_PAYOUT_ATTEMPTS) {
    return { processed: false, skipped: true };
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.revenuePayout.update({
        where: { id },
        data: {
          status: "FAILED",
          failureReason: reason,
          nextRunAt: null
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "INTERNAL_SERVICE",
          action: "revenue_payout.operator_action_required",
          entityType: "RevenuePayout",
          entityId: payout.id,
          payload: {
            reason,
            attempts: payout.attempts,
            providerResponse: payout.responsePayload
          } as Prisma.InputJsonValue
        }
      });

      await tx.retryJob.create({
        data: {
          transactionId: null,
          queueName: "revenue-payout",
          reason,
          status: "FAILED",
          attempts: payout.attempts,
          payload: {
            revenuePayoutId: payout.id,
            provider: payout.provider,
            providerResponse: payout.responsePayload
          } as Prisma.InputJsonValue
        }
      });
    },
    prismaTransactionOptions
  );

  await enqueueAppRevenuePayoutWebhookIfNeeded(payout.id, "review_required");

  return { processed: true, status: "UNDER_REVIEW" as const, reason };
}

async function failRevenuePayout(id: string, reason: string, payload: Record<string, unknown>) {
  await prisma.$transaction(
    async (tx) => {
      const payout = await tx.revenuePayout.update({
        where: { id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          failureReason: reason,
          nextRunAt: null,
          responsePayload: payload as Prisma.InputJsonValue
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "INTERNAL_SERVICE",
          action: "revenue_payout.operator_action_required",
          entityType: "RevenuePayout",
          entityId: payout.id,
          payload: {
            reason,
            ...payload
          }
        }
      });
    },
    prismaTransactionOptions
  );
}

function maskPayoutTarget(value: string) {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function buildDestinationProfileLookup(input: {
  appId: string;
  destinationProfileId?: string;
  externalRecipientId?: string;
}) {
  const candidates: Array<{ id: string } | { externalRecipientId: string }> = [];

  if (input.destinationProfileId) {
    candidates.push({ id: input.destinationProfileId });
    candidates.push({ externalRecipientId: input.destinationProfileId });
  }

  if (input.externalRecipientId && input.externalRecipientId !== input.destinationProfileId) {
    candidates.push({ externalRecipientId: input.externalRecipientId });
  }

  if (candidates.length === 0) {
    throw new Error("destinationProfileId or externalRecipientId is required");
  }

  return {
    appId: input.appId,
    deletedAt: null,
    OR: candidates
  };
}

async function resolveRevenuePayoutTarget(
  payout: RevenuePayout & { payoutDestination?: { destinationRef: string } | null }
) {
  if (payout.payoutDestination?.destinationRef) {
    return {
      type: "payout_destination",
      value: payout.payoutDestination.destinationRef,
      destinationProfileId: undefined
    };
  }

  const metadata = asRecord(payout.metadata);
  const destinationProfileId = typeof metadata.destinationProfileId === "string" ? metadata.destinationProfileId : null;
  const appId = typeof metadata.appId === "string" ? metadata.appId : null;

  if (!destinationProfileId || !appId) {
    return null;
  }

  const profile = await prisma.destinationProfile.findFirst({
    where: {
      id: destinationProfileId,
      appId,
      organizationId: payout.organizationId,
      deletedAt: null
    }
  });

  if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.payoutTarget) {
    return null;
  }

  return {
    type: "destination_profile",
    value: profile.payoutTarget,
    destinationProfileId: profile.id
  };
}

function isAppRevenuePayout(payout: Pick<RevenuePayout, "metadata">) {
  return asRecord(payout.metadata).source === "app_revenue_payout";
}

async function enqueueAppRevenuePayoutWebhookIfNeeded(revenuePayoutId: string, status: string) {
  const eventType = `payout.${status}`;
  if (webhookQueue) {
    const queue = webhookQueue;
    const result = await addQueueJobSafely("webhook-queue", () =>
      queue.add(
        "dispatch-app-revenue-payout-webhook",
        {
          revenuePayoutId,
          eventType
        },
        {
          jobId: `webhook:revenue-payout:${revenuePayoutId}:${eventType}`
        }
      )
    );

    if (result.enqueued) return;
  }

  try {
    const { dispatchAppRevenuePayoutWebhook } = await import("../webhooks/app-webhook.service.js");
    await dispatchAppRevenuePayoutWebhook({
      revenuePayoutId,
      eventType,
      attempt: 1
    });
  } catch {
    // dispatchAppRevenuePayoutWebhook records failed attempts in RetryJob; keep payout finality independent.
  }
}

function serializeAppRevenuePayoutResponse(payout: RevenuePayout) {
  const metadata = asRecord(payout.metadata);
  return {
    id: payout.id,
    reference: typeof metadata.externalReference === "string" ? metadata.externalReference : payout.id,
    flowpayReference: payout.id,
    provider: payout.provider,
    status: mapAppRevenuePayoutStatus(payout.status),
    amount: Number(payout.amount),
    currency: payout.currency
  };
}

function mapAppRevenuePayoutStatus(status: RevenuePayoutStatus): "pending" | "queued" | "processing" | "success" | "failed" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  if (status === "PROCESSING") return "processing";
  return "pending";
}

function readProviderRuntimeMode(metadata: unknown): "sandbox" | "live" | null {
  return normalizeRuntimeMode(asRecord(metadata).providerRuntimeMode);
}

function normalizeRuntimeMode(value: unknown): "sandbox" | "live" | null {
  if (value === "SANDBOX" || value === "sandbox") return "sandbox";
  if (value === "LIVE" || value === "live") return "live";
  return null;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
