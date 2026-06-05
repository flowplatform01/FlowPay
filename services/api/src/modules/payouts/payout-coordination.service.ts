import { Prisma, type PayoutCoordinationStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";

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
      attempts: { lt: 6 },
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

  const adapter = getGatewayAdapter(coordination.provider);
  if (!adapter.executePayout) {
    const reason = `${coordination.provider} adapter does not support payout execution; operator payout action is required`;
    await failCoordination(coordination.id, reason, {
      provider: coordination.provider,
      destinationProfileId: destinationProfile.id,
      payoutTarget: maskPayoutTarget(destinationProfile.payoutTarget)
    });
    return { processed: true, status: "FAILED" as PayoutCoordinationStatus, reason };
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
    const result = await adapter.executePayout({
      transactionId: coordination.transactionId,
      payoutCoordinationId: coordination.id,
      destinationProfileId: destinationProfile.id,
      payoutTarget: destinationProfile.payoutTarget,
      amount: Number(coordination.transaction.settlementAmount),
      currency: coordination.transaction.currency,
      idempotencyKey: coordination.idempotencyKey,
      metadata: {
        externalRecipientId: destinationProfile.externalRecipientId,
        settlementStrategy: destinationProfile.settlementStrategy
      }
    });

    const nextStatus = mapPayoutStatus(result.status);

    await prisma.$transaction(
      async (tx) => {
        await tx.payoutCoordination.update({
          where: { id: coordination.id },
          data: {
            status: nextStatus,
            responsePayload: result.raw as Prisma.InputJsonValue,
            failureReason: nextStatus === "FAILED" ? "Provider payout execution failed" : null,
            nextRunAt: nextStatus === "PENDING" ? nextPayoutAttemptAt(coordination.attempts + 1) : null
          }
        });

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
            eventType: `payout_coordination.${nextStatus.toLowerCase()}`,
            payload: {
              payoutCoordinationId: coordination.id,
              provider: coordination.provider,
              providerReference: result.providerReference,
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
              provider: coordination.provider,
              status: nextStatus,
              transactionId: coordination.transactionId
            }
          }
        });
      },
      prismaTransactionOptions
    );

    return { processed: true, status: nextStatus };
  } catch (error) {
    const reason = formatErrorMessage(error);
    const retryable = coordination.attempts + 1 < 6;

    await prisma.payoutCoordination.update({
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

    return { processed: true, status: "FAILED" as PayoutCoordinationStatus, reason };
  }
}

function validatePayoutCoordination(coordination: CoordinationForProcessing) {
  if (coordination.transaction.status !== "SUCCEEDED") {
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

function mapPayoutStatus(status: "PENDING" | "SUCCESS" | "FAILED"): PayoutCoordinationStatus {
  if (status === "SUCCESS") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

function nextPayoutAttemptAt(attempts: number) {
  return new Date(Date.now() + Math.min(attempts * 60_000, 15 * 60_000));
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
