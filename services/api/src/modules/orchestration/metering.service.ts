import { Prisma, type OrchestrationMeterEventType } from "@prisma/client";
import { prisma } from "../../config/db.js";

const DEFAULT_PROCESSING_UNITS = 1;
const DEFAULT_ORCHESTRATION_CREDITS = 1;

type MeteringBalanceRow = {
  infrastructureUsageBalanceBefore: Prisma.Decimal;
  infrastructureUsageBalanceAfter: Prisma.Decimal;
};

export async function assertApplicationHasInfrastructureCapacity(appId: string) {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    select: {
      infrastructureUsageBalance: true,
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
