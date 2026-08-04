import { Prisma, type GatewayProvider, type PayoutCoordinationStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import type { GatewayPayoutResult } from "../gateways/gateway.types.js";
import { addQueueJobSafely, webhookQueue } from "../../lib/queues.js";

const MAX_PAYOUT_ATTEMPTS = 6;

type CoordinationForProcessing = Prisma.PayoutCoordinationGetPayload<{
  include: {
    destinationProfile: true;
    transaction: {
      include: {
        settlements: true;
      };
    };
  };
}>;

export async function listPayoutCoordinations() {
  return prisma.payoutCoordination.findMany({
    include: {
      transaction: {
        include: {
          app: true,
          organization: true
        }
      },
      destinationProfile: true
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
}

export async function processDuePayoutCoordinations(limit = 25) {
  const cutoff = new Date(Date.now() - 30_000);
  const items = await prisma.payoutCoordination.findMany({
    where: {
      attempts: { lt: MAX_PAYOUT_ATTEMPTS },
      OR: [
        { status: "PENDING", nextRunAt: null, createdAt: { lt: cutoff } },
        { status: { in: ["PENDING", "FAILED"] }, nextRunAt: { lte: new Date() } }
      ]
    },
    select: { id: true },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });

  for (const item of items) {
    await processPayoutCoordination(item.id);
  }

  const exhaustedItems = await prisma.payoutCoordination.findMany({
    where: {
      status: "PENDING",
      attempts: { gte: MAX_PAYOUT_ATTEMPTS },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
    },
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }],
    take: limit
  });

  for (const item of exhaustedItems) {
    await markPayoutCoordinationReviewRequired(
      item.id,
      "Provider accepted payout but did not return a terminal confirmation after all retry attempts"
    );
  }
}

export async function processPayoutCoordination(id: string) {
  const coordination = await prisma.payoutCoordination.findUnique({
    where: { id },
    include: {
      destinationProfile: true,
      transaction: {
        include: {
          settlements: true
        }
      }
    }
  });

  if (!coordination) {
    throw new Error(`Payout coordination ${id} was not found`);
  }

  if (["PROCESSING", "SUCCEEDED"].includes(coordination.status)) {
    return { processed: false, status: coordination.status, skipped: true };
  }

  const validationError = validatePayoutCoordination(coordination);
  if (validationError) {
    await failCoordination(coordination.id, validationError, {
      status: coordination.status,
      transactionStatus: coordination.transaction.status,
      destinationProfileId: coordination.destinationProfileId
    });
    return { processed: true, status: "FAILED" as PayoutCoordinationStatus, reason: validationError };
  }

  const destinationProfile = coordination.destinationProfile;
  if (!destinationProfile) {
    throw new Error("Validated payout coordination is missing destination profile");
  }

  const claimed = await prisma.payoutCoordination.updateMany({
    where: {
      id: coordination.id,
      status: { in: ["PENDING", "FAILED"] }
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      failureReason: null
    }
  });

  if (claimed.count !== 1) {
    return { processed: false, status: coordination.status, skipped: true };
  }

  try {
    const attemptedProviders: Array<Record<string, unknown>> = [];
    const providerCandidates = resolvePayoutProviderCandidates(coordination);
    let selectedProvider: GatewayProvider | null = null;
    let result: GatewayPayoutResult | null = null;

    for (const candidate of providerCandidates) {
      const adapter = getGatewayAdapter(candidate);

      if (!adapter.executePayout) {
        attemptedProviders.push({
          provider: candidate,
          status: "SKIPPED",
          reason: "Adapter does not support payout execution"
        });
        continue;
      }

      const candidateResult = await adapter.executePayout({
        transactionId: coordination.transactionId,
        payoutCoordinationId: coordination.id,
        destinationProfileId: destinationProfile.id,
        payoutTarget: destinationProfile.payoutTarget,
        amount: Number(coordination.transaction.settlementAmount),
        currency: coordination.transaction.currency,
        idempotencyKey: `${coordination.idempotencyKey}:${candidate}`,
        metadata: {
          externalRecipientId: destinationProfile.externalRecipientId,
          settlementStrategy: destinationProfile.settlementStrategy,
          primaryProvider: coordination.provider,
          attemptedProvider: candidate,
          fallbackUsed: candidate !== coordination.provider
        }
      });

      attemptedProviders.push({
        provider: candidate,
        status: candidateResult.status,
        providerReference: candidateResult.providerReference
      });

      selectedProvider = candidate;
      result = candidateResult;

      if (candidateResult.status !== "FAILED") {
        break;
      }
    }

    if (!result || !selectedProvider) {
      const reason = "No configured provider can execute this payout; operator payout action is required";
      await failCoordination(coordination.id, reason, {
        primaryProvider: coordination.provider,
        attemptedProviders,
        destinationProfileId: destinationProfile.id,
        payoutTarget: maskPayoutTarget(destinationProfile.payoutTarget)
      });
      return { processed: true, status: "FAILED" as PayoutCoordinationStatus, reason };
    }

    const nextStatus = mapPayoutStatus(result.status);
    const attemptNumber = coordination.attempts + 1;
    const retryable = nextStatus === "FAILED" && attemptNumber < MAX_PAYOUT_ATTEMPTS;
    const pendingExhausted = nextStatus === "PENDING" && attemptNumber >= MAX_PAYOUT_ATTEMPTS;
    const isAppPayout = isAppPayoutTransaction(coordination);
    const nextTransactionStatus =
      nextStatus === "SUCCEEDED"
        ? "SUCCEEDED"
        : nextStatus === "FAILED" && !retryable
          ? "FAILED"
          : pendingExhausted
            ? "UNDER_REVIEW"
          : "PROCESSING";
    const reviewReason =
      "Provider accepted payout but did not return a terminal confirmation after all retry attempts";

    await prisma.$transaction(
      async (tx) => {
        await tx.payoutCoordination.update({
          where: { id: coordination.id },
          data: {
            provider: selectedProvider,
            status: pendingExhausted ? "FAILED" : nextStatus,
            responsePayload: result.raw as Prisma.InputJsonValue,
            failureReason: pendingExhausted
              ? reviewReason
              : nextStatus === "FAILED"
                ? "Provider payout execution failed"
                : null,
            nextRunAt:
              !pendingExhausted && (nextStatus === "PENDING" || retryable)
                ? nextPayoutAttemptAt(coordination.attempts + 1)
                : null
          }
        });

        if (isAppPayout) {
          await tx.transaction.update({
            where: { id: coordination.transactionId },
            data: {
              status: nextTransactionStatus,
              failureReason:
                nextTransactionStatus === "FAILED"
                  ? "Provider payout execution failed"
                  : nextTransactionStatus === "UNDER_REVIEW"
                    ? reviewReason
                    : null
            }
          });
        }

        if (nextStatus === "SUCCEEDED") {
          await tx.settlement.updateMany({
            where: {
              transactionId: coordination.transactionId,
              status: "COLLECTED_PENDING_PAYOUT"
            },
            data: { status: "SETTLED" }
          });
        }

        await tx.transactionEvent.create({
          data: {
            transactionId: coordination.transactionId,
            eventType: pendingExhausted
              ? "payout_coordination.operator_action_required"
              : `payout_coordination.${nextStatus.toLowerCase()}`,
            payload: {
              payoutCoordinationId: coordination.id,
              provider: selectedProvider,
              primaryProvider: coordination.provider,
              fallbackUsed: selectedProvider !== coordination.provider,
              attemptedProviders,
              providerReference: result.providerReference,
              reason: pendingExhausted ? reviewReason : undefined,
              response: result.raw
            } as Prisma.InputJsonValue
          }
        });

        await tx.auditLog.create({
          data: {
            actorType: "INTERNAL_SERVICE",
            action: "payout_coordination.processed",
            entityType: "PayoutCoordination",
            entityId: coordination.id,
            payload: {
              provider: selectedProvider,
              primaryProvider: coordination.provider,
              fallbackUsed: selectedProvider !== coordination.provider,
              status: pendingExhausted ? "UNDER_REVIEW" : nextStatus,
              transactionId: coordination.transactionId
            }
          }
        });

        if (pendingExhausted) {
          await tx.retryJob.create({
            data: {
              transactionId: coordination.transactionId,
              queueName: "payout-coordination",
              reason: reviewReason,
              status: "FAILED",
              attempts: attemptNumber,
              payload: {
                payoutCoordinationId: coordination.id,
                provider: selectedProvider,
                primaryProvider: coordination.provider,
                attemptedProviders,
                providerReference: result.providerReference
              } as Prisma.InputJsonValue
            }
          });
        }
      },
      prismaTransactionOptions
    );

    if (isAppPayout && ["SUCCEEDED", "FAILED"].includes(nextTransactionStatus)) {
      await enqueueAppPayoutWebhook(coordination.transactionId, nextTransactionStatus.toLowerCase());
    } else if (isAppPayout && nextTransactionStatus === "UNDER_REVIEW") {
      await enqueueAppPayoutWebhook(coordination.transactionId, "review_required");
    }

    return { processed: true, status: nextStatus };
  } catch (error) {
    const reason = formatErrorMessage(error);
    const retryable = coordination.attempts + 1 < MAX_PAYOUT_ATTEMPTS;
    const isAppPayout = isAppPayoutTransaction(coordination);

    await prisma.$transaction(
      async (tx) => {
        await tx.payoutCoordination.update({
          where: { id: coordination.id },
          data: {
            status: "FAILED",
            failureReason: reason,
            nextRunAt: retryable ? nextPayoutAttemptAt(coordination.attempts + 1) : null,
            responsePayload: {
              error: reason
            }
          }
        });

        if (isAppPayout && !retryable) {
          await tx.transaction.update({
            where: { id: coordination.transactionId },
            data: {
              status: "FAILED",
              failureReason: reason
            }
          });
        }
      },
      prismaTransactionOptions
    );

    if (isAppPayout && !retryable) {
      await enqueueAppPayoutWebhook(coordination.transactionId, "failed");
    }

    return { processed: true, status: "FAILED" as PayoutCoordinationStatus, reason };
  }
}

function validatePayoutCoordination(coordination: CoordinationForProcessing) {
  const validSourceStatus = isAppPayoutTransaction(coordination)
    ? ["PROCESSING", "SUCCEEDED"].includes(coordination.transaction.status)
    : coordination.transaction.status === "SUCCEEDED";

  if (!validSourceStatus) {
    return `Transaction is ${coordination.transaction.status}; payout cannot execute`;
  }

  if (coordination.transaction.orchestrationMode !== "MULTI_TENANT") {
    return "Payout coordination is only valid for Mode 2 multi-tenant transactions";
  }

  if (coordination.transaction.settlementStrategy !== "TWO_STEP_MIRROR") {
    return `Settlement strategy ${coordination.transaction.settlementStrategy} does not require payout coordination`;
  }

  if (!coordination.destinationProfile) {
    return "Destination profile is missing";
  }

  if (coordination.destinationProfile.verificationStatus !== "VERIFIED") {
    return `Destination profile is ${coordination.destinationProfile.verificationStatus}`;
  }

  if (!coordination.destinationProfile.payoutTarget) {
    return "Destination profile does not have a payout target";
  }

  return null;
}

function isAppPayoutTransaction(coordination: CoordinationForProcessing) {
  const metadata = coordination.transaction.metadata;
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).source === "app_payout"
  );
}

async function enqueueAppPayoutWebhook(transactionId: string, status: string) {
  if (!webhookQueue) return;
  const eventType = `payout.${status}`;
  const queue = webhookQueue;
  await addQueueJobSafely("webhook-queue", () =>
    queue.add(
      "dispatch-app-webhook",
      {
        transactionId,
        eventType
      },
      {
        jobId: `webhook:${transactionId}:${eventType}`
      }
    )
  );
}

function mapPayoutStatus(status: "PENDING" | "SUCCESS" | "FAILED"): PayoutCoordinationStatus {
  if (status === "SUCCESS") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

function resolvePayoutProviderCandidates(coordination: CoordinationForProcessing) {
  const primary = coordination.provider;
  const preferences = asRecord(coordination.destinationProfile?.routingPreferences);
  const fallbackEnabled =
    preferences.payoutFallbackEnabled === true ||
    preferences.allowPayoutFallbackProviders === true ||
    preferences.fallbackEnabled === true;

  if (!fallbackEnabled) {
    return [primary];
  }

  const fallbackProviders = Array.isArray(preferences.fallbackProviders)
    ? preferences.fallbackProviders
    : Array.isArray(preferences.payoutFallbackProviders)
      ? preferences.payoutFallbackProviders
      : [];

  const candidates = [primary];
  for (const provider of fallbackProviders) {
    if (isGatewayProvider(provider) && !candidates.includes(provider)) {
      candidates.push(provider);
    }
  }

  return candidates;
}

function nextPayoutAttemptAt(attempts: number) {
  return new Date(Date.now() + Math.min(attempts * 60_000, 15 * 60_000));
}

async function markPayoutCoordinationReviewRequired(id: string, reason: string) {
  const coordination = await prisma.payoutCoordination.findUnique({
    where: { id },
    include: {
      transaction: {
        include: {
          settlements: true
        }
      },
      destinationProfile: true
    }
  });

  if (!coordination || coordination.status !== "PENDING" || coordination.attempts < MAX_PAYOUT_ATTEMPTS) {
    return { processed: false, skipped: true };
  }

  const isAppPayout = isAppPayoutTransaction(coordination);

  await prisma.$transaction(
    async (tx) => {
      await tx.payoutCoordination.update({
        where: { id },
        data: {
          status: "FAILED",
          failureReason: reason,
          nextRunAt: null
        }
      });

      if (isAppPayout) {
        await tx.transaction.update({
          where: { id: coordination.transactionId },
          data: {
            status: "UNDER_REVIEW",
            failureReason: reason
          }
        });
      }

      await tx.transactionEvent.create({
        data: {
          transactionId: coordination.transactionId,
          eventType: "payout_coordination.operator_action_required",
          payload: {
            payoutCoordinationId: coordination.id,
            provider: coordination.provider,
            reason,
            attempts: coordination.attempts,
            providerResponse: coordination.responsePayload
          } as Prisma.InputJsonValue
        }
      });

      await tx.retryJob.create({
        data: {
          transactionId: coordination.transactionId,
          queueName: "payout-coordination",
          reason,
          status: "FAILED",
          attempts: coordination.attempts,
          payload: {
            payoutCoordinationId: coordination.id,
            provider: coordination.provider,
            providerResponse: coordination.responsePayload
          } as Prisma.InputJsonValue
        }
      });
    },
    prismaTransactionOptions
  );

  if (isAppPayout) {
    await enqueueAppPayoutWebhook(coordination.transactionId, "review_required");
  }

  return { processed: true, status: "UNDER_REVIEW" as const, reason };
}

async function failCoordination(id: string, reason: string, payload: Record<string, unknown>) {
  await prisma.$transaction(
    async (tx) => {
      const coordination = await tx.payoutCoordination.update({
        where: { id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          failureReason: reason,
          nextRunAt: null,
          responsePayload: payload as Prisma.InputJsonValue
        }
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: coordination.transactionId,
          eventType: "payout_coordination.operator_action_required",
          payload: {
            payoutCoordinationId: coordination.id,
            provider: coordination.provider,
            reason,
            ...payload
          } as Prisma.InputJsonValue
        }
      });

      await tx.retryJob.create({
        data: {
          transactionId: coordination.transactionId,
          queueName: "payout-coordination",
          reason,
          status: "FAILED",
          attempts: coordination.attempts,
          payload: {
            payoutCoordinationId: coordination.id,
            provider: coordination.provider,
            ...payload
          } as Prisma.InputJsonValue
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

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isGatewayProvider(value: unknown): value is GatewayProvider {
  return typeof value === "string" && gatewayProviders.has(value as GatewayProvider);
}

const gatewayProviders = new Set<GatewayProvider>([
  "CAMPAY",
  "FAPSHI",
  "MAVIANCE",
  "CINETPAY",
  "FLUTTERWAVE",
  "MONETBIL"
]);
