import { prisma } from "../../config/db.js";

export interface SandboxPruneOptions {
  /**
   * Number of days to retain sandbox transaction and simulation records.
   * Default is 30 days to allow active developer debugging and integration QA.
   */
  retentionDays?: number;
  /**
   * Maximum transactions to process in a single batch.
   * Default is 250.
   */
  batchSize?: number;
  /**
   * Optional appId filter to prune sandbox records for a specific developer application.
   */
  appId?: string;
}

export interface SandboxPruneResult {
  retentionDays: number;
  cutoffDate: Date;
  prunedTransactions: number;
  prunedPaymentAttempts: number;
  prunedSettlements: number;
  prunedEvents: number;
  prunedMeteringEntries: number;
  prunedTreasuryEntries: number;
  hasMore: boolean;
}

/**
 * Production-grade Sandbox Data Pruning Service.
 *
 * Implements a safe, tiered Time-To-Live (TTL) retention cleanup for FlowPay:
 * 1. Strictly filters by `livemode: false` — cryptographically impossible to touch live financial records.
 * 2. Cascades deletion across all simulation artifacts (payment attempts, settlements, metering ledgers, events).
 * 3. Operates in bounded batches to avoid transaction lock contention or memory exhaustion on large test datasets.
 */
export async function pruneExpiredSandboxData(
  options: SandboxPruneOptions = {}
): Promise<SandboxPruneResult> {
  const retentionDays = Math.max(options.retentionDays ?? 30, 1);
  const batchSize = Math.min(Math.max(options.batchSize ?? 250, 1), 1000);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  console.info(
    `[Sandbox Retention] Starting pruning: retentionDays=${retentionDays}, cutoff=${cutoffDate.toISOString()}, batchSize=${batchSize}${options.appId ? `, appId=${options.appId}` : ""}`
  );

  // Find target expired sandbox transaction IDs in a bounded batch
  const expiredTransactions = await prisma.transaction.findMany({
    where: {
      livemode: false, // HARD INVARIANT: Only simulated sandbox records
      createdAt: { lt: cutoffDate },
      ...(options.appId ? { appId: options.appId } : {})
    },
    select: { id: true },
    take: batchSize,
    orderBy: { createdAt: "asc" }
  });

  const transactionIds = expiredTransactions.map((tx) => tx.id);
  const hasMore = expiredTransactions.length === batchSize;

  let prunedPaymentAttempts = 0;
  let prunedSettlements = 0;
  let prunedEvents = 0;
  let prunedMeteringEntries = 0;
  let prunedTreasuryEntries = 0;
  let prunedTransactions = 0;

  if (transactionIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      // 1. Delete dependent payment attempts
      const attempts = await tx.paymentAttempt.deleteMany({
        where: {
          transactionId: { in: transactionIds },
          livemode: false
        }
      });
      prunedPaymentAttempts = attempts.count;

      // 2. Delete dependent transaction events
      const events = await tx.transactionEvent.deleteMany({
        where: {
          transactionId: { in: transactionIds }
        }
      });
      prunedEvents = events.count;

      // 3. Delete dependent settlements
      const settlements = await tx.settlement.deleteMany({
        where: {
          transactionId: { in: transactionIds },
          livemode: false
        }
      });
      prunedSettlements = settlements.count;

      // 4. Delete dependent webhook logs & retry jobs
      await tx.webhookLog.deleteMany({
        where: { transactionId: { in: transactionIds } }
      });
      await tx.retryJob.deleteMany({
        where: { transactionId: { in: transactionIds } }
      });

      // 5. Delete dependent payout coordination records
      await tx.payoutCoordination.deleteMany({
        where: {
          transactionId: { in: transactionIds },
          livemode: false
        }
      });

      // 6. Delete dependent sandbox treasury ledger entries
      const treasury = await tx.treasuryLedgerEntry.deleteMany({
        where: {
          sourceTransactionId: { in: transactionIds },
          livemode: false
        }
      });
      prunedTreasuryEntries = treasury.count;

      // 7. Delete dependent sandbox metering ledger entries
      const metering = await tx.orchestrationMeteringLedger.deleteMany({
        where: {
          transactionId: { in: transactionIds },
          livemode: false
        }
      });
      prunedMeteringEntries = metering.count;

      // 8. Delete the sandbox transactions themselves
      const deletedTxs = await tx.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
          livemode: false // Double defense-in-depth guarantee
        }
      });
      prunedTransactions = deletedTxs.count;
    });
  }

  // Also clean up any unlinked/orphaned sandbox metering records older than cutoff
  const orphanedMetering = await prisma.orchestrationMeteringLedger.deleteMany({
    where: {
      livemode: false,
      transactionId: null,
      createdAt: { lt: cutoffDate },
      ...(options.appId ? { appId: options.appId } : {})
    }
  });
  prunedMeteringEntries += orphanedMetering.count;

  const result: SandboxPruneResult = {
    retentionDays,
    cutoffDate,
    prunedTransactions,
    prunedPaymentAttempts,
    prunedSettlements,
    prunedEvents,
    prunedMeteringEntries,
    prunedTreasuryEntries,
    hasMore
  };

  console.info("[Sandbox Retention] Completed batch:", result);
  return result;
}
