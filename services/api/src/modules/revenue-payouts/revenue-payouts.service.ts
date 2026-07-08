import { Prisma, type GatewayProvider, type RevenuePayoutStatus } from "@prisma/client";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";

const reservingStatuses: RevenuePayoutStatus[] = ["PENDING", "PROCESSING", "SUCCEEDED"];

export async function getRevenuePayoutBalance(input: {
  organizationId: string;
  currency: string;
}) {
  const currency = input.currency.toUpperCase();
  const [settledPlatformRevenue, reservedPayouts] = await Promise.all([
    prisma.settlement.aggregate({
      where: {
        organizationId: input.organizationId,
        status: "SETTLED",
        transaction: {
          orchestrationMode: "PLATFORM_REVENUE",
          status: "SUCCEEDED",
          currency
        }
      },
      _sum: {
        settlementAmount: true
      }
    }),
    prisma.revenuePayout.aggregate({
      where: {
        organizationId: input.organizationId,
        currency,
        status: { in: reservingStatuses }
      },
      _sum: {
        amount: true
      }
    })
  ]);

  const collected = Number(settledPlatformRevenue._sum.settlementAmount ?? 0);
  const reserved = Number(reservedPayouts._sum.amount ?? 0);

  return {
    organizationId: input.organizationId,
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
      attempts: { lt: 6 },
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

  if (!payout.payoutDestination) {
    await failRevenuePayout(payout.id, "Payout destination is missing", {});
    return { processed: true, status: "FAILED" as RevenuePayoutStatus, reason: "Payout destination is missing" };
  }

  const adapter = getGatewayAdapter(payout.provider);
  if (!adapter.executePayout) {
    const reason = `${payout.provider} adapter does not support revenue payout execution`;
    await failRevenuePayout(payout.id, reason, { provider: payout.provider });
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
    const result = await adapter.executePayout({
      transactionId: `revenue:${payout.id}`,
      payoutCoordinationId: payout.id,
      payoutTarget: payout.payoutDestination.destinationRef,
      amount: Number(payout.amount),
      currency: payout.currency,
      idempotencyKey: payout.idempotencyKey,
      metadata: {
        organizationId: payout.organizationId,
        payoutDestinationId: payout.payoutDestinationId,
        payoutType: "PLATFORM_REVENUE_EXIT"
      }
    });

    const nextStatus = mapPayoutStatus(result.status);

    await prisma.$transaction(
      async (tx) => {
        await tx.revenuePayout.update({
          where: { id: payout.id },
          data: {
            status: nextStatus,
            responsePayload: result.raw as Prisma.InputJsonValue,
            failureReason: nextStatus === "FAILED" ? "Provider revenue payout execution failed" : null,
            nextRunAt: nextStatus === "PENDING" ? nextRevenuePayoutAttemptAt(payout.attempts + 1) : null
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
              status: nextStatus
            }
          }
        });
      },
      prismaTransactionOptions
    );

    return { processed: true, status: nextStatus, providerReference: result.providerReference };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const retryable = payout.attempts + 1 < 6;

    await prisma.revenuePayout.update({
      where: { id: payout.id },
      data: {
        status: "FAILED",
        failureReason: reason,
        nextRunAt: retryable ? nextRevenuePayoutAttemptAt(payout.attempts + 1) : null,
        responsePayload: { error: reason }
      }
    });

    return { processed: true, status: "FAILED" as RevenuePayoutStatus, reason };
  }
}

function mapPayoutStatus(status: "PENDING" | "SUCCESS" | "FAILED"): RevenuePayoutStatus {
  if (status === "SUCCESS") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

function nextRevenuePayoutAttemptAt(attempts: number) {
  return new Date(Date.now() + Math.min(attempts * 60_000, 15 * 60_000));
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
