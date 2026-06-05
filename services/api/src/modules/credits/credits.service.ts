import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { generateOpaqueKey } from "../../utils/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";

// ─── Balance ──────────────────────────────────────────────────────────────────

export async function getCreditBalance(appId: string) {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    select: {
      id: true,
      name: true,
      slug: true,
      orchestrationCredits: true,
      processingUnits: true,
      infrastructureUsageBalance: true,
      mode1MeteringEnabled: true,
      mode2MeteringEnabled: true,
      organization: {
        select: {
          id: true,
          name: true,
          settlementCurrency: true
        }
      }
    }
  });

  const orchestrationCredits = Number(app.orchestrationCredits);
  const processingUnits = Number(app.processingUnits);
  const infrastructureUsageBalance = Number(app.infrastructureUsageBalance);

  // Derive the effective credit balance as the minimum across all three balance
  // dimensions — an app is considered depleted if any single dimension hits zero.
  const effectiveBalance = Math.min(orchestrationCredits, processingUnits, infrastructureUsageBalance);

  const posture: "healthy" | "low" | "critical" | "depleted" =
    effectiveBalance <= 0
      ? "depleted"
      : effectiveBalance < 5
        ? "critical"
        : effectiveBalance < 50
          ? "low"
          : "healthy";

  return {
    appId: app.id,
    appName: app.name,
    appSlug: app.slug,
    organization: app.organization,
    meteringEnabled: app.mode1MeteringEnabled || app.mode2MeteringEnabled,
    balances: {
      orchestrationCredits,
      processingUnits,
      infrastructureUsageBalance
    },
    effectiveBalance,
    posture,
    depleted: effectiveBalance <= 0
  };
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getCreditHistory(
  appId: string,
  options: { cursor?: string; limit?: number } = {}
) {
  const limit = Math.min(options.limit ?? 50, 100);

  const entries = await prisma.orchestrationMeteringLedger.findMany({
    where: { appId },
    include: {
      transaction: {
        select: {
          id: true,
          externalReference: true,
          status: true,
          selectedProvider: true,
          amount: true,
          platformFeeAmount: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options.cursor
      ? {
          cursor: { id: options.cursor },
          skip: 1
        }
      : {})
  });

  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  return {
    entries: page.map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      creditsConsumed: Number(entry.orchestrationCredits),
      processingUnitsConsumed: Number(entry.processingUnits),
      balanceBefore: Number(entry.infrastructureUsageBalanceBefore),
      balanceAfter: Number(entry.infrastructureUsageBalanceAfter),
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      transaction: entry.transaction
        ? {
            id: entry.transaction.id,
            externalReference: entry.transaction.externalReference,
            status: entry.transaction.status,
            provider: entry.transaction.selectedProvider,
            amount: Number(entry.transaction.amount),
            platformFeeAmount: Number(entry.transaction.platformFeeAmount)
          }
        : null
    })),
    pagination: {
      hasMore,
      nextCursor,
      limit
    }
  };
}

// ─── Credit Purchase ───────────────────────────────────────────────────────────

/**
 * Initiate a self-service credit top-up for a developer application.
 *
 * Architecture: The developer pays for credits using the existing FlowPay payment
 * infrastructure. A purchase intent record is created, and a checkout URL is
 * returned. On payment success, completeCreditPurchase() is called automatically
 * by the webhook handler to apply the credit increase.
 *
 * Credit rate: 1 XAF = 1 credit unit (parity). This means the credit amount
 * applied equals the net XAF amount received by FlowPay after gateway fees.
 */
export async function initiateCreditPurchase(
  appId: string,
  input: {
    amountXaf: number;
    customerPhone?: string;
    customerEmail?: string;
    customerName?: string;
  }
) {
  if (!Number.isFinite(input.amountXaf) || input.amountXaf < 100) {
    throw new Error("Credit purchase amount must be at least 100 XAF");
  }

  if (input.amountXaf > 10_000_000) {
    throw new Error("Credit purchase amount must not exceed 10,000,000 XAF per transaction");
  }

  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    select: {
      id: true,
      name: true,
      status: true,
      organizationId: true
    }
  });

  if (app.status !== "ACTIVE") {
    throw new Error("Application must be active to purchase credits");
  }

  // Create a durable purchase intent record before initiating checkout.
  // This ensures we can reconcile even if the webhook arrives before the
  // checkout confirmation is fully written.
  const purchaseRef = generateOpaqueKey("cpurchase");

  const purchase = await prisma.creditPurchaseIntent.create({
    data: {
      appId,
      externalReference: purchaseRef,
      amountXaf: input.amountXaf.toFixed(2),
      status: "PENDING"
    }
  });

  await recordAuditEvent({
    action: "credit_purchase.initiated",
    actorType: "APP",
    actorId: appId,
    entityType: "CreditPurchaseIntent",
    entityId: purchase.id,
    payload: {
      amountXaf: input.amountXaf,
      purchaseRef
    }
  });

  return {
    purchaseIntentId: purchase.id,
    externalReference: purchaseRef,
    amountXaf: input.amountXaf,
    status: "PENDING",
    // Instructions for the caller: pass these details to /payments/initialize
    // using the app's own credentials, then redirect the customer to the returned
    // checkout URL. On payment success, FlowPay will automatically top up credits.
    instructions: {
      endpoint: "POST /api/v1/payments/initialize",
      externalReference: purchaseRef,
      amount: input.amountXaf,
      currency: "XAF",
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      metadata: {
        __flowpay_credit_purchase: true,
        purchaseIntentId: purchase.id,
        appId
      }
    }
  };
}

/**
 * Complete a credit purchase after successful payment.
 * Called internally when a transaction with __flowpay_credit_purchase metadata succeeds.
 *
 * Credit allocation uses 1:1 parity with the purchased credit value.
 * Checkout/customer fees are treated as add-ons and do not reduce credits.
 */
export async function completeCreditPurchase(input: {
  transactionId: string;
  purchaseIntentId: string;
  settlementAmount: number;
}) {
  const [purchase, transaction] = await Promise.all([
    prisma.creditPurchaseIntent.findUniqueOrThrow({
      where: { id: input.purchaseIntentId },
      select: {
        id: true,
        appId: true,
        externalReference: true,
        amountXaf: true,
        status: true,
        transactionId: true
      }
    }),
    prisma.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: {
        id: true,
        appId: true,
        externalReference: true,
        amount: true,
        status: true
      }
    })
  ]);

  if (purchase.status === "COMPLETED") {
    if (purchase.transactionId && purchase.transactionId !== input.transactionId) {
      throw new Error("Credit purchase has already been completed by another transaction");
    }
    return getCreditBalance(purchase.appId);
  }

  if (purchase.status === "FAILED") {
    throw new Error("Credit purchase has already been marked as failed");
  }

  if (transaction.status !== "SUCCEEDED") {
    throw new Error("Credit purchase transaction has not succeeded");
  }

  if (transaction.appId !== purchase.appId) {
    throw new Error("Credit purchase transaction does not belong to the purchasing application");
  }

  if (transaction.externalReference !== purchase.externalReference) {
    throw new Error("Credit purchase transaction reference does not match purchase intent");
  }

  if (purchase.transactionId && purchase.transactionId !== input.transactionId) {
    throw new Error("Credit purchase intent is already linked to another transaction");
  }

  if (Number(transaction.amount) !== Number(purchase.amountXaf)) {
    throw new Error("Credit purchase transaction amount does not match purchase intent");
  }

  const creditAmount = input.settlementAmount;

  if (creditAmount <= 0) {
    throw new Error("Settlement amount is insufficient to apply credits");
  }

  await prisma.$transaction(async (tx) => {
    await tx.app.update({
      where: { id: purchase.appId },
      data: {
        orchestrationCredits: {
          increment: creditAmount
        },
        processingUnits: {
          increment: Math.ceil(creditAmount)
        },
        infrastructureUsageBalance: {
          increment: creditAmount
        }
      }
    });

    await tx.creditPurchaseIntent.update({
      where: { id: purchase.id },
      data: {
        status: "COMPLETED",
        transactionId: input.transactionId,
        completedAt: new Date(),
        creditAmountApplied: creditAmount.toFixed(2)
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "credit_purchase.completed",
        entityType: "CreditPurchaseIntent",
        entityId: purchase.id,
        payload: {
          appId: purchase.appId,
          transactionId: input.transactionId,
          creditAmountApplied: creditAmount,
          settlementAmount: input.settlementAmount
        } as Prisma.InputJsonValue
      }
    });
  });

  return getCreditBalance(purchase.appId);
}

function isCreditPurchaseMetadata(
  metadata: unknown
): metadata is Record<string, unknown> & {
  __flowpay_credit_purchase: true;
  purchaseIntentId: string;
} {
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>).__flowpay_credit_purchase === true &&
    typeof (metadata as Record<string, unknown>).purchaseIntentId === "string"
  );
}

/**
 * Finalize a credit purchase when a linked transaction reaches a terminal status.
 * Safe to call from multiple paths — completion is idempotent.
 */
export async function maybeFinalizeCreditPurchaseFromTransaction(transaction: {
  id: string;
  status: string;
  metadata: unknown;
  settlementAmount: Prisma.Decimal | number | string;
  failureReason?: string | null;
}) {
  if (!isCreditPurchaseMetadata(transaction.metadata)) {
    return;
  }

  const purchaseIntentId = transaction.metadata.purchaseIntentId;

  if (transaction.status === "SUCCEEDED") {
    try {
      await completeCreditPurchase({
        transactionId: transaction.id,
        purchaseIntentId,
        settlementAmount: Number(transaction.settlementAmount)
      });
    } catch (err) {
      console.error("Failed to complete credit purchase for transaction", transaction.id, err);
    }
    return;
  }

  if (transaction.status === "FAILED") {
    try {
      await failCreditPurchase(
        purchaseIntentId,
        transaction.failureReason ?? "Transaction failed"
      );
    } catch (err) {
      console.error("Failed to mark credit purchase failed", purchaseIntentId, err);
    }
  }
}

export function isCreditPurchaseTransaction(metadata?: Record<string, unknown> | null) {
  return metadata?.__flowpay_credit_purchase === true;
}

/**
 * Mark a credit purchase as failed (called when the payment fails or times out).
 */
export async function failCreditPurchase(purchaseIntentId: string, reason: string) {
  const purchase = await prisma.creditPurchaseIntent.findUnique({
    where: { id: purchaseIntentId }
  });

  if (!purchase || purchase.status !== "PENDING") return;

  await prisma.creditPurchaseIntent.update({
    where: { id: purchaseIntentId },
    data: {
      status: "FAILED",
      failureReason: reason
    }
  });

  await recordAuditEvent({
    action: "credit_purchase.failed",
    actorType: "INTERNAL_SERVICE",
    entityType: "CreditPurchaseIntent",
    entityId: purchaseIntentId,
    payload: { reason }
  });
}

/**
 * List credit purchase history for an app.
 */
export async function listCreditPurchases(appId: string) {
  const purchases = await prisma.creditPurchaseIntent.findMany({
    where: { appId },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return purchases.map((p) => ({
    id: p.id,
    externalReference: p.externalReference,
    amountXaf: Number(p.amountXaf),
    creditAmountApplied: p.creditAmountApplied ? Number(p.creditAmountApplied) : null,
    status: p.status,
    transactionId: p.transactionId,
    failureReason: p.failureReason,
    createdAt: p.createdAt,
    completedAt: p.completedAt
  }));
}
