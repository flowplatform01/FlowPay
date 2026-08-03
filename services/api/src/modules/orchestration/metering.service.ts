import { GatewayProvider, Prisma, type OrchestrationMeterEventType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db.js";

const DEFAULT_PROCESSING_UNITS = 1;
const DEFAULT_ORCHESTRATION_CREDITS = 1;

type MeteringBalanceRow = {
  infrastructureUsageBalanceBefore: Prisma.Decimal;
  infrastructureUsageBalanceAfter: Prisma.Decimal;
};
type MeteringWriter = Pick<typeof prisma, "app" | "treasuryLedgerEntry" | "auditLog">;

export async function assertApplicationHasInfrastructureCapacity(appId: string) {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    select: {
        infrastructureUsageBalance: true,
        autoCreditRefillEnabled: true,
        autoCreditRefillThreshold: true,
        autoCreditRefillAmount: true,
        autoCreditRefillProvider: true,
        processingUnits: true,
        orchestrationCredits: true
      }
    });

  if (
    Number(app.infrastructureUsageBalance) <= 0 ||
    Number(app.processingUnits) <= 0 ||
    Number(app.orchestrationCredits) <= 0
  ) {
    throw new Error("Application infrastructure usage balance is depleted");
  }
}

export async function consumeOrchestrationMetering(input: {
  appId: string;
  transactionId?: string;
  eventType: OrchestrationMeterEventType;
  processingUnits?: number;
  orchestrationCredits?: number;
  feeAlignedAmount?: number;
  metadata?: Record<string, unknown>;
}) {
  const processingUnits = input.processingUnits ?? DEFAULT_PROCESSING_UNITS;
  const orchestrationCredits =
    input.feeAlignedAmount !== undefined
      ? Math.max(0, input.feeAlignedAmount)
      : (input.orchestrationCredits ?? DEFAULT_ORCHESTRATION_CREDITS);

  return prisma.$transaction(async (tx) => {
    await maybeAutoRefillCredits(tx, {
      appId: input.appId,
      requiredCredits: orchestrationCredits,
      requiredProcessingUnits: processingUnits,
      transactionId: input.transactionId,
      eventType: input.eventType
    });

    const [balance] = await tx.$queryRaw<MeteringBalanceRow[]>(Prisma.sql`
      UPDATE "App"
      SET
        "infrastructureUsageBalance" = "infrastructureUsageBalance" - ${orchestrationCredits},
        "processingUnits" = "processingUnits" - ${processingUnits},
        "orchestrationCredits" = "orchestrationCredits" - ${orchestrationCredits}
      WHERE
        "id" = ${input.appId}
        AND "infrastructureUsageBalance" >= ${orchestrationCredits}
        AND "processingUnits" >= ${processingUnits}
        AND "orchestrationCredits" >= ${orchestrationCredits}
      RETURNING
        ("infrastructureUsageBalance" + ${orchestrationCredits}) AS "infrastructureUsageBalanceBefore",
        "infrastructureUsageBalance" AS "infrastructureUsageBalanceAfter"
    `);

    if (!balance) {
      throw new Error("Application infrastructure usage balance is depleted");
    }

    const before = Number(balance.infrastructureUsageBalanceBefore);
    const after = Number(balance.infrastructureUsageBalanceAfter);

    return tx.orchestrationMeteringLedger.create({
      data: {
        appId: input.appId,
        transactionId: input.transactionId,
        eventType: input.eventType,
        processingUnits: processingUnits.toFixed(2),
        orchestrationCredits: orchestrationCredits.toFixed(2),
        infrastructureUsageBalanceBefore: before.toFixed(2),
        infrastructureUsageBalanceAfter: after.toFixed(2),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  });
}

async function maybeAutoRefillCredits(
  tx: MeteringWriter,
  input: {
    appId: string;
    requiredCredits: number;
    requiredProcessingUnits: number;
    transactionId?: string;
    eventType: OrchestrationMeterEventType;
  }
) {
  const app = await tx.app.findUniqueOrThrow({
    where: { id: input.appId },
    select: {
      infrastructureUsageBalance: true,
      processingUnits: true,
      orchestrationCredits: true,
      autoCreditRefillEnabled: true,
      autoCreditRefillThreshold: true,
      autoCreditRefillAmount: true,
      autoCreditRefillProvider: true
    }
  });

  if (!app.autoCreditRefillEnabled || !app.autoCreditRefillProvider) {
    return;
  }

  const current = {
    infrastructureUsageBalance: Number(app.infrastructureUsageBalance),
    processingUnits: Number(app.processingUnits),
    orchestrationCredits: Number(app.orchestrationCredits)
  };
  const effectiveBalance = Math.min(
    current.infrastructureUsageBalance,
    current.processingUnits,
    current.orchestrationCredits
  );
  const threshold = Number(app.autoCreditRefillThreshold);
  const refillAmount = Number(app.autoCreditRefillAmount);

  if (!Number.isFinite(refillAmount) || refillAmount <= 0) {
    return;
  }

  const wouldFail =
    current.infrastructureUsageBalance < input.requiredCredits ||
    current.processingUnits < input.requiredProcessingUnits ||
    current.orchestrationCredits < input.requiredCredits;
  const belowThreshold = effectiveBalance <= threshold;

  if (!wouldFail && !belowThreshold) {
    return;
  }

  const treasuryBalance = await getTreasuryBalanceForProvider(tx, "XAF", app.autoCreditRefillProvider);
  if (treasuryBalance < refillAmount) {
    return;
  }

  const after = {
    infrastructureUsageBalance: current.infrastructureUsageBalance + refillAmount,
    processingUnits: current.processingUnits + Math.ceil(refillAmount),
    orchestrationCredits: current.orchestrationCredits + refillAmount
  };
  const reference = `treasury:auto-credit-refill:${input.appId}:${randomUUID()}`;

  await tx.app.update({
    where: { id: input.appId },
    data: {
      infrastructureUsageBalance: after.infrastructureUsageBalance.toFixed(2),
      processingUnits: after.processingUnits.toFixed(2),
      orchestrationCredits: after.orchestrationCredits.toFixed(2)
    }
  });

  await tx.treasuryLedgerEntry.create({
    data: {
      entryType: "APP_CREDIT_REFILL",
      direction: "DEBIT",
      status: "SETTLED",
      provider: app.autoCreditRefillProvider,
      currency: "XAF",
      amount: refillAmount.toFixed(2),
      reference,
      description: `Automatic treasury-funded credit refill for app ${input.appId}`,
      metadata: {
        appId: input.appId,
        provider: app.autoCreditRefillProvider,
        transactionId: input.transactionId ?? null,
        eventType: input.eventType,
        trigger: wouldFail ? "WOULD_DEPLETE" : "BELOW_THRESHOLD",
        threshold,
        before: current,
        after
      } as Prisma.InputJsonValue
    }
  });

  await tx.auditLog.create({
    data: {
      actorType: "INTERNAL_SERVICE",
      action: "treasury.app_credit_refill_auto_funded",
      entityType: "App",
      entityId: input.appId,
      payload: {
        amount: refillAmount,
        currency: "XAF",
        provider: app.autoCreditRefillProvider,
        reference,
        transactionId: input.transactionId ?? null,
        before: current,
        after
      } as Prisma.InputJsonValue
    }
  });
}

async function getTreasuryBalanceForProvider(
  tx: MeteringWriter,
  currency: string,
  provider: GatewayProvider
) {
  const groups = await tx.treasuryLedgerEntry.groupBy({
    by: ["direction", "status"],
    where: {
      currency,
      provider,
      status: { in: ["AVAILABLE", "SETTLED"] }
    },
    _sum: { amount: true }
  });

  return groups.reduce((total, group) => {
    const amount = Number(group._sum.amount ?? 0);
    return total + (group.direction === "CREDIT" ? amount : -amount);
  }, 0);
}
