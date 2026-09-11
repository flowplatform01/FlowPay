import { pruneExpiredSandboxData } from "../src/modules/maintenance/sandbox-retention.service.js";

async function main() {
  const args = process.argv.slice(2);
  let retentionDays = 30;
  let appId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      retentionDays = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--app" && args[i + 1]) {
      appId = args[i + 1];
      i++;
    }
  }

  console.log(`[Sandbox Retention] Pruning sandbox records older than ${retentionDays} days...`);
  if (appId) {
    console.log(`[Sandbox Retention] Scoped to appId: ${appId}`);
  }

  let totalPrunedTxs = 0;
  let iterations = 0;
  const maxIterations = 20;

  while (iterations < maxIterations) {
    iterations++;
    const result = await pruneExpiredSandboxData({
      retentionDays,
      batchSize: 250,
      appId
    });

    totalPrunedTxs += result.prunedTransactions;

    if (!result.hasMore) {
      break;
    }
  }

  console.log(`[Sandbox Retention] Complete. Total sandbox transactions pruned: ${totalPrunedTxs}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[Sandbox Retention] Failed:", err);
  process.exit(1);
});
