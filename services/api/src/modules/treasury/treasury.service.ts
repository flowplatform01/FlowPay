import { randomUUID } from "node:crypto";
import { GatewayProvider, Prisma, type TransactionStatus } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import { assertProviderCanAcceptTraffic } from "../providers/provider-registry.js";

type TreasuryWriter = Pick<typeof prisma, "treasuryLedgerEntry">;

type TreasuryTransactionInput = {
  id: string;
  status: TransactionStatus;
  currency: string;
  platformFeeAmount: Prisma.Decimal;
  externalReference: string;
  selectedProvider: string;
  appId: string;
  organizationId: string;
};

type CreateTreasuryWithdrawalInput = {
  amount: number;
  currency: string;
  provider: GatewayProvider;
  destinationType: string;
  destinationRef: string;
  requestedBy?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

type FundAppCreditsFromTreasuryInput = {
  appId: string;
  amount: number;
  currency: string;
  provider: GatewayProvider;
  actorId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordPlatformFeeCapture(
  tx: TreasuryWriter,
  transaction: TreasuryTransactionInput
) {
  const amount = Number(transaction.platformFeeAmount);
  if (transaction.status !== "SUCCEEDED" || !Number.isFinite(amount) || amount <= 0) {
    return { recorded: false, reason: "No confirmed platform fee to capture" };
  }

  const entry = await tx.treasuryLedgerEntry.upsert({
    where: {
      sourceTransactionId_entryType: {
        sourceTransactionId: transaction.id,
        entryType: "PLATFORM_FEE_CAPTURED"
      }
    },
    update: {},
    create: {
      entryType: "PLATFORM_FEE_CAPTURED",
      direction: "CREDIT",
      status: "AVAILABLE",
      provider: transaction.selectedProvider as GatewayProvider,
      currency: transaction.currency,
      amount: transaction.platformFeeAmount,
      sourceTransactionId: transaction.id,
      reference: `treasury:platform-fee:${transaction.id}`,
      description: `Platform fee captured for ${transaction.externalReference}`,
      metadata: {
        provider: transaction.selectedProvider,
        appId: transaction.appId,
        organizationId: transaction.organizationId,
        externalReference: transaction.externalReference
      } as Prisma.InputJsonValue
    }
  });

  return { recorded: true, entryId: entry.id };
}

export async function reconcileTreasuryLedger(input?: { limit?: number }) {
  const limit = Math.min(Math.max(input?.limit ?? 500, 1), 2_000);
  const missingBefore = await countMissingTreasuryCaptures();
  const transactions = await prisma.transaction.findMany({
    where: {
      status: "SUCCEEDED",
      platformFeeAmount: { gt: 0 },
      treasuryLedgerEntries: {
        none: {
          entryType: "PLATFORM_FEE_CAPTURED"
        }
      }
    },
    select: {
      id: true,
      status: true,
      currency: true,
      platformFeeAmount: true,
      externalReference: true,
      selectedProvider: true,
      appId: true,
      organizationId: true
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  const result = transactions.length
    ? await prisma.treasuryLedgerEntry.createMany({
        data: transactions.map((transaction) => ({
          entryType: "PLATFORM_FEE_CAPTURED",
          direction: "CREDIT",
          status: "AVAILABLE",
          provider: transaction.selectedProvider,
          currency: transaction.currency,
          amount: transaction.platformFeeAmount,
          sourceTransactionId: transaction.id,
          reference: `treasury:platform-fee:${transaction.id}`,
          description: `Platform fee captured for ${transaction.externalReference}`,
          metadata: {
            provider: transaction.selectedProvider,
            appId: transaction.appId,
            organizationId: transaction.organizationId,
            externalReference: transaction.externalReference
          } as Prisma.InputJsonValue
        })),
        skipDuplicates: true
      })
    : { count: 0 };

  return {
    inspected: transactions.length,
    recorded: result.count,
    remainingEstimate:
      missingBefore <= transactions.length
        ? 0
        : Math.max(0, missingBefore - result.count)
  };
}

export async function createTreasuryWithdrawal(input: CreateTreasuryWithdrawalInput) {
  const amount = normalizeAmount(input.amount);
  const currency = normalizeCurrency(input.currency);
  const destinationType = input.destinationType.trim();
  const destinationRef = input.destinationRef.trim();

  if (!destinationType || !destinationRef) {
    throw new Error("Treasury withdrawal destination type and destination reference are required");
  }

  return prisma.$transaction(async (tx) => {
    const balance = await getSpendableTreasuryBalance(currency, input.provider);
    if (balance < amount) {
      throw new Error(`Insufficient FlowPay ${input.provider} treasury balance. Available ${balance} ${currency}`);
    }

    const withdrawal = await tx.treasuryWithdrawal.create({
      data: {
        amount: new Prisma.Decimal(amount),
        currency,
        provider: input.provider,
        status: "PENDING_APPROVAL",
        destinationType,
        destinationRef,
        idempotencyKey: `treasury-withdrawal:${randomUUID()}`,
        requestedBy: input.requestedBy ?? null,
        requestPayload: {
          amount,
          currency,
          provider: input.provider,
          destinationType,
          destinationRef,
          reason: input.reason ?? null
        } as Prisma.InputJsonValue,
        metadata: {
          ...(input.metadata ?? {}),
          reason: input.reason ?? null
        } as Prisma.InputJsonValue
      }
    });

    await tx.treasuryLedgerEntry.create({
      data: {
        entryType: "WITHDRAWAL_RESERVED",
        direction: "DEBIT",
        status: "AVAILABLE",
        provider: input.provider,
        currency,
        amount: withdrawal.amount,
        sourceWithdrawalId: withdrawal.id,
        reference: `treasury:withdrawal-reserved:${withdrawal.id}`,
        description: `Treasury withdrawal reserved for ${destinationType}`,
        metadata: {
          provider: input.provider,
          destinationType,
          destinationRef,
          requestedBy: input.requestedBy ?? null,
          reason: input.reason ?? null
        } as Prisma.InputJsonValue
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: input.requestedBy ?? null,
        action: "treasury.withdrawal_requested",
        entityType: "TreasuryWithdrawal",
        entityId: withdrawal.id,
        payload: {
          amount,
          currency,
          provider: input.provider,
          destinationType,
          destinationRef,
          reason: input.reason ?? null
        } as Prisma.InputJsonValue
      }
    });

    return withdrawal;
  });
}

export async function approveTreasuryWithdrawal(id: string, actorId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.treasuryWithdrawal.findUniqueOrThrow({
      where: { id }
    });

    if (withdrawal.status !== "PENDING_APPROVAL") {
      throw new Error(`Treasury withdrawal cannot be approved while status is ${withdrawal.status}`);
    }

    const updated = await tx.treasuryWithdrawal.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: actorId ?? "internal"
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actorId ?? null,
        action: "treasury.withdrawal_approved",
        entityType: "TreasuryWithdrawal",
        entityId: id,
        payload: {
          amount: withdrawal.amount.toString(),
          currency: withdrawal.currency,
          provider: withdrawal.provider
        } as Prisma.InputJsonValue
      }
    });

    return updated;
  });
}

export async function cancelTreasuryWithdrawal(id: string, actorId?: string | null, reason?: string | null) {
  return reverseTreasuryWithdrawal(id, "CANCELLED", actorId, reason ?? "Treasury withdrawal cancelled");
}

export async function executeTreasuryWithdrawal(id: string, actorId?: string | null) {
  const withdrawal = await prisma.treasuryWithdrawal.findUnique({
    where: { id }
  });

  if (!withdrawal) {
    throw new Error(`Treasury withdrawal ${id} was not found`);
  }

  if (withdrawal.status === "SUCCEEDED") {
    return { processed: false, status: withdrawal.status, skipped: true };
  }

  if (withdrawal.status !== "APPROVED") {
    throw new Error(`Treasury withdrawal cannot be executed while status is ${withdrawal.status}`);
  }

  if (!withdrawal.provider) {
    await reverseTreasuryWithdrawal(id, "FAILED", actorId, "Treasury withdrawal provider is missing");
    return { processed: true, status: "FAILED", reason: "Treasury withdrawal provider is missing" };
  }

  const gateway = await prisma.gatewayConfig.findUniqueOrThrow({
    where: { provider: withdrawal.provider },
    include: { health: true }
  });
  assertProviderCanAcceptTraffic(withdrawal.provider, gateway);

  const adapter = getGatewayAdapter(withdrawal.provider);
  if (!adapter.executePayout) {
    await reverseTreasuryWithdrawal(id, "FAILED", actorId, `${withdrawal.provider} does not support treasury withdrawal execution`);
    return {
      processed: true,
      status: "FAILED",
      reason: `${withdrawal.provider} does not support treasury withdrawal execution`
    };
  }

  const claimed = await prisma.treasuryWithdrawal.updateMany({
    where: { id, status: { in: ["APPROVED", "FAILED"] } },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      failureReason: null
    }
  });

  if (claimed.count !== 1) {
    const current = await prisma.treasuryWithdrawal.findUniqueOrThrow({ where: { id } });
    return { processed: false, status: current.status, skipped: true };
  }

  try {
    const result = await adapter.executePayout({
      transactionId: `treasury:${withdrawal.id}`,
      payoutCoordinationId: withdrawal.id,
      payoutTarget: withdrawal.destinationRef,
      amount: Number(withdrawal.amount),
      currency: withdrawal.currency,
      idempotencyKey: withdrawal.idempotencyKey,
      metadata: {
        payoutType: "FLOWPAY_TREASURY_WITHDRAWAL",
        destinationType: withdrawal.destinationType,
        actorId: actorId ?? null
      }
    });

    if (result.status === "SUCCESS") {
      const updated = await markTreasuryWithdrawalSucceeded(id, result.providerReference ?? null, result.raw, actorId);
      return {
        processed: true,
        status: updated.status,
        providerReference: updated.providerReference
      };
    }

    if (result.status === "PENDING") {
      const updated = await prisma.treasuryWithdrawal.update({
        where: { id },
        data: {
          status: "PROCESSING",
          providerReference: result.providerReference ?? null,
          responsePayload: result.raw as Prisma.InputJsonValue
        }
      });
      return { processed: true, status: updated.status, providerReference: updated.providerReference };
    }

    await reverseTreasuryWithdrawal(id, "FAILED", actorId, "Provider treasury withdrawal execution failed", result.raw);
    return { processed: true, status: "FAILED", reason: "Provider treasury withdrawal execution failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Treasury withdrawal execution failed";
    await reverseTreasuryWithdrawal(id, "FAILED", actorId, message);
    return { processed: true, status: "FAILED", reason: message };
  }
}

export async function getTreasuryOverview() {
  const [
    balanceGroups,
    ledgerEntryCount,
    recentLedger,
    missingPlatformFeeCaptures,
    pendingFees,
    withdrawals
  ] = await Promise.all([
    prisma.treasuryLedgerEntry.groupBy({
      by: ["provider", "currency", "direction", "status", "entryType"],
      _sum: { amount: true },
      _count: { _all: true }
    }),
    prisma.treasuryLedgerEntry.count(),
    prisma.treasuryLedgerEntry.findMany({
      include: {
        transaction: {
          select: {
            externalReference: true,
            selectedProvider: true,
            status: true,
            app: { select: { name: true } },
            organization: { select: { name: true } }
          }
        },
        withdrawal: true
      },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    countMissingTreasuryCaptures(),
    prisma.transaction.aggregate({
      where: {
        status: { in: ["PENDING", "REQUIRES_ACTION", "PROCESSING", "UNDER_REVIEW"] },
        platformFeeAmount: { gt: 0 }
      },
      _sum: { platformFeeAmount: true }
    }),
    prisma.treasuryWithdrawal.findMany({
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  const balancesByCurrency = new Map<string, {
    currency: string;
    availableBalance: number;
    pendingBalance: number;
    settledBalance: number;
    historicalRevenue: number;
    debits: number;
    entries: number;
  }>();
  const balancesByGateway = new Map<string, {
    provider: GatewayProvider | "UNASSIGNED";
    currency: string;
    availableBalance: number;
    pendingBalance: number;
    settledBalance: number;
    historicalRevenue: number;
    debits: number;
    entries: number;
  }>();

  for (const group of balanceGroups) {
    const currency = group.currency;
    const provider = group.provider ?? "UNASSIGNED";
    const gatewayKey = `${provider}:${currency}`;
    const current =
      balancesByCurrency.get(currency) ??
      {
        currency,
        availableBalance: 0,
        pendingBalance: 0,
        settledBalance: 0,
        historicalRevenue: 0,
        debits: 0,
        entries: 0
      };
    const gatewayCurrent =
      balancesByGateway.get(gatewayKey) ??
      {
        provider,
        currency,
        availableBalance: 0,
        pendingBalance: 0,
        settledBalance: 0,
        historicalRevenue: 0,
        debits: 0,
        entries: 0
      };
    const amount = Number(group._sum.amount ?? 0);
    const signedAmount = group.direction === "CREDIT" ? amount : -amount;

    current.entries += group._count._all;
    gatewayCurrent.entries += group._count._all;

    if (group.status === "PENDING") {
      current.pendingBalance += signedAmount;
      gatewayCurrent.pendingBalance += signedAmount;
    }

    if (group.status === "AVAILABLE" || group.status === "SETTLED") {
      current.availableBalance += signedAmount;
      gatewayCurrent.availableBalance += signedAmount;
    }

    if (group.status === "SETTLED") {
      current.settledBalance += signedAmount;
      gatewayCurrent.settledBalance += signedAmount;
    }

    if (group.entryType === "PLATFORM_FEE_CAPTURED" && group.direction === "CREDIT" && group.status !== "VOID") {
      current.historicalRevenue += amount;
      gatewayCurrent.historicalRevenue += amount;
    }

    if (group.direction === "DEBIT" && group.status !== "VOID") {
      current.debits += amount;
      gatewayCurrent.debits += amount;
    }

    balancesByCurrency.set(currency, current);
    balancesByGateway.set(gatewayKey, gatewayCurrent);
  }

  const balances = Array.from(balancesByCurrency.values()).sort((left, right) =>
    left.currency.localeCompare(right.currency)
  );
  const gatewayBalances = Array.from(balancesByGateway.values()).sort((left, right) =>
    left.provider === right.provider
      ? left.currency.localeCompare(right.currency)
      : left.provider.localeCompare(right.provider)
  );
  const primary = balances.find((balance) => balance.currency === "XAF") ?? balances[0] ?? {
    currency: "XAF",
    availableBalance: 0,
    pendingBalance: 0,
    settledBalance: 0,
    historicalRevenue: 0,
    debits: 0,
    entries: 0
  };

  return {
    metrics: {
      currency: primary.currency,
      totalPlatformRevenue: primary.historicalRevenue,
      availableTreasuryBalance: primary.availableBalance,
      pendingTreasuryBalance: primary.pendingBalance,
      settledTreasuryBalance: primary.settledBalance,
      pendingFees: Number(pendingFees._sum.platformFeeAmount ?? 0),
      totalDebits: primary.debits,
      ledgerEntries: ledgerEntryCount,
      missingPlatformFeeCaptures,
      reconciliationStatus: missingPlatformFeeCaptures === 0 ? "RECONCILED" : "ACTION_REQUIRED"
    },
    balances,
    gatewayBalances,
    ledger: recentLedger.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      direction: entry.direction,
      status: entry.status,
      provider: entry.provider ?? entry.transaction?.selectedProvider ?? entry.withdrawal?.provider ?? null,
      currency: entry.currency,
      amount: entry.amount.toString(),
      reference: entry.reference,
      description: entry.description,
      sourceTransactionId: entry.sourceTransactionId,
      sourceWithdrawalId: entry.sourceWithdrawalId,
      createdAt: entry.createdAt,
      transaction: entry.transaction
        ? {
            externalReference: entry.transaction.externalReference,
            selectedProvider: entry.transaction.selectedProvider,
            status: entry.transaction.status,
            appName: entry.transaction.app.name,
            organizationName: entry.transaction.organization.name
          }
        : null
    })),
    withdrawals: withdrawals.map((withdrawal) => ({
      id: withdrawal.id,
      amount: withdrawal.amount.toString(),
      currency: withdrawal.currency,
      status: withdrawal.status,
      provider: withdrawal.provider,
      destinationType: withdrawal.destinationType,
      destinationRef: withdrawal.destinationRef,
      idempotencyKey: withdrawal.idempotencyKey,
      attempts: withdrawal.attempts,
      providerReference: withdrawal.providerReference,
      requestedBy: withdrawal.requestedBy,
      approvedBy: withdrawal.approvedBy,
      processedAt: withdrawal.processedAt,
      failureReason: withdrawal.failureReason,
      requestPayload: withdrawal.requestPayload,
      responsePayload: withdrawal.responsePayload,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt
    }))
  };
}

async function markTreasuryWithdrawalSucceeded(
  id: string,
  providerReference: string | null,
  responsePayload: Record<string, unknown>,
  actorId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.treasuryWithdrawal.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        providerReference,
        responsePayload: responsePayload as Prisma.InputJsonValue,
        processedAt: new Date(),
        failureReason: null
      }
    });

    await tx.treasuryLedgerEntry.updateMany({
      where: {
        sourceWithdrawalId: id,
        entryType: "WITHDRAWAL_RESERVED",
        status: { not: "VOID" }
      },
      data: { status: "VOID" }
    });

    await tx.treasuryLedgerEntry.create({
      data: {
        entryType: "WITHDRAWAL_EXECUTED",
        direction: "DEBIT",
        status: "SETTLED",
        provider: withdrawal.provider,
        currency: withdrawal.currency,
        amount: withdrawal.amount,
        sourceWithdrawalId: withdrawal.id,
        reference: `treasury:withdrawal-executed:${withdrawal.id}`,
        description: `Treasury withdrawal executed to ${withdrawal.destinationType}`,
        metadata: {
          provider: withdrawal.provider,
          providerReference,
          actorId: actorId ?? null
        } as Prisma.InputJsonValue
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actorId ?? null,
        action: "treasury.withdrawal_executed",
        entityType: "TreasuryWithdrawal",
        entityId: id,
        payload: {
          provider: withdrawal.provider,
          providerReference,
          amount: withdrawal.amount.toString(),
          currency: withdrawal.currency
        } as Prisma.InputJsonValue
      }
    });

    return withdrawal;
  });
}

async function reverseTreasuryWithdrawal(
  id: string,
  status: "FAILED" | "CANCELLED",
  actorId?: string | null,
  reason?: string | null,
  responsePayload?: Record<string, unknown>
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.treasuryWithdrawal.findUniqueOrThrow({
      where: { id }
    });

    if (["SUCCEEDED", "CANCELLED"].includes(existing.status)) {
      return existing;
    }

    const updated = await tx.treasuryWithdrawal.update({
      where: { id },
      data: {
        status,
        failureReason: reason ?? null,
        responsePayload: responsePayload === undefined ? undefined : (responsePayload as Prisma.InputJsonValue)
      }
    });

    await tx.treasuryLedgerEntry.create({
      data: {
        entryType: "WITHDRAWAL_REVERSED",
        direction: "CREDIT",
        status: "AVAILABLE",
        provider: existing.provider,
        currency: existing.currency,
        amount: existing.amount,
        sourceWithdrawalId: existing.id,
        reference: `treasury:withdrawal-reversed:${existing.id}:${status.toLowerCase()}`,
        description: `Treasury withdrawal ${status.toLowerCase()}`,
        metadata: {
          reason: reason ?? null,
          actorId: actorId ?? null
        } as Prisma.InputJsonValue
      }
    }).catch(async (error) => {
      if (isUniqueConstraintError(error)) {
        return null;
      }
      throw error;
    });

    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actorId ?? null,
        action: status === "FAILED" ? "treasury.withdrawal_failed" : "treasury.withdrawal_cancelled",
        entityType: "TreasuryWithdrawal",
        entityId: id,
        payload: {
          provider: existing.provider,
          amount: existing.amount.toString(),
          currency: existing.currency,
          reason: reason ?? null
        } as Prisma.InputJsonValue
      }
    });

    return updated;
  });
}

async function countMissingTreasuryCaptures() {
  return prisma.transaction.count({
    where: {
      status: "SUCCEEDED",
      platformFeeAmount: { gt: 0 },
      treasuryLedgerEntries: {
        none: {
          entryType: "PLATFORM_FEE_CAPTURED"
        }
      }
    }
  });
}

export async function fundAppCreditsFromTreasury(input: FundAppCreditsFromTreasuryInput) {
  const amount = normalizeAmount(input.amount);
  const currency = normalizeCurrency(input.currency);

  return prisma.$transaction(async (tx) => {
    const balance = await getSpendableTreasuryBalance(currency, input.provider);
    if (balance < amount) {
      throw new Error(`Insufficient FlowPay ${input.provider} treasury balance. Available ${balance} ${currency}`);
    }

    const app = await tx.app.findUniqueOrThrow({
      where: { id: input.appId },
      select: {
        infrastructureUsageBalance: true,
        processingUnits: true,
        orchestrationCredits: true
      }
    });
    const before = {
      infrastructureUsageBalance: Number(app.infrastructureUsageBalance),
      processingUnits: Number(app.processingUnits),
      orchestrationCredits: Number(app.orchestrationCredits)
    };
    const after = {
      infrastructureUsageBalance: before.infrastructureUsageBalance + amount,
      processingUnits: before.processingUnits + Math.ceil(amount),
      orchestrationCredits: before.orchestrationCredits + amount
    };

    const updated = await tx.app.update({
      where: { id: input.appId },
      data: {
        infrastructureUsageBalance: after.infrastructureUsageBalance.toFixed(2),
        processingUnits: after.processingUnits.toFixed(2),
        orchestrationCredits: after.orchestrationCredits.toFixed(2)
      }
    });

    const reference = `treasury:app-credit-refill:${input.appId}:${randomUUID()}`;
    await tx.treasuryLedgerEntry.create({
      data: {
        entryType: "APP_CREDIT_REFILL",
        direction: "DEBIT",
        status: "SETTLED",
        provider: input.provider,
        currency,
        amount: new Prisma.Decimal(amount),
        reference,
        description: `Treasury-funded credit refill for app ${input.appId}`,
        metadata: {
          ...(input.metadata ?? {}),
          appId: input.appId,
          provider: input.provider,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
          before,
          after
        } as Prisma.InputJsonValue
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: input.actorId ? "ADMIN" : "INTERNAL_SERVICE",
        actorId: input.actorId ?? null,
        action: "treasury.app_credit_refill_funded",
        entityType: "App",
        entityId: input.appId,
        payload: {
          amount,
          currency,
          provider: input.provider,
          reference,
          reason: input.reason ?? null,
          before,
          after
        } as Prisma.InputJsonValue
      }
    });

    return updated;
  });
}

async function getSpendableTreasuryBalance(currency: string, provider?: GatewayProvider | null) {
  const groups = await prisma.treasuryLedgerEntry.groupBy({
    by: ["direction", "status"],
    where: {
      currency,
      provider: provider ?? undefined,
      status: { in: ["AVAILABLE", "SETTLED"] }
    },
    _sum: { amount: true }
  });

  return groups.reduce((total, group) => {
    const amount = Number(group._sum.amount ?? 0);
    return total + (group.direction === "CREDIT" ? amount : -amount);
  }, 0);
}

function normalizeAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Treasury withdrawal amount must be positive");
  }

  return Math.round(amount * 100) / 100;
}

function normalizeCurrency(currency: string) {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Treasury withdrawal currency must be a valid 3-letter code");
  }

  return normalized;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
