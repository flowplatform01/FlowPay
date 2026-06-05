import type { OrchestrationMode, SettlementStatus, SettlementStrategy, TransactionStatus } from "@prisma/client";

type SettlementWriter = {
  settlement: {
    updateMany: (args: {
      where: {
        transactionId: string;
        status: {
          in: Array<"PENDING" | "PROCESSING">;
        };
      };
      data: {
        status: SettlementStatus;
      };
    }) => Promise<{ count: number }>;
  };
};

export function buildSettlementBreakdown(input: {
  amount: number;
  grossAmount: number;
  gatewayFeeAmount: number;
  platformFeeAmount: number;
}) {
  return {
    netAmount: input.amount,
    settlementAmount: input.amount,
    grossAmount: input.grossAmount,
    gatewayFeeAmount: input.gatewayFeeAmount,
    platformFeeAmount: input.platformFeeAmount
  };
}

export function settlementStatusForTransaction(
  status: TransactionStatus,
  routing?: {
    orchestrationMode?: OrchestrationMode | null;
    settlementStrategy?: SettlementStrategy | null;
  }
): SettlementStatus | null {
  if (status === "SUCCEEDED") {
    if (routing?.orchestrationMode === "MULTI_TENANT" && routing.settlementStrategy === "TWO_STEP_MIRROR") {
      return "COLLECTED_PENDING_PAYOUT";
    }

    return "SETTLED";
  }

  if (["FAILED", "CANCELLED", "EXPIRED"].includes(status)) return "FAILED";
  return null;
}

export async function finalizeSettlementsForTransaction(
  tx: SettlementWriter,
  input: {
    transactionId: string;
    status: TransactionStatus;
    orchestrationMode?: OrchestrationMode | null;
    settlementStrategy?: SettlementStrategy | null;
  }
) {
  const settlementStatus = settlementStatusForTransaction(input.status, {
    orchestrationMode: input.orchestrationMode,
    settlementStrategy: input.settlementStrategy
  });
  if (!settlementStatus) {
    return { updated: 0, status: null };
  }

  const result = await tx.settlement.updateMany({
    where: {
      transactionId: input.transactionId,
      status: {
        in: ["PENDING", "PROCESSING"]
      }
    },
    data: {
      status: settlementStatus
    }
  });

  return { updated: result.count, status: settlementStatus };
}
