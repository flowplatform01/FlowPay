-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PayoutCoordination" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TreasuryLedgerEntry" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RevenuePayout" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OrchestrationMeteringLedger" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;

-- DropIndex
DROP INDEX IF EXISTS "Transaction_appId_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_appId_livemode_idempotencyKey_key" ON "Transaction"("appId", "livemode", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_livemode_status_createdAt_idx" ON "Transaction"("livemode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_livemode_status_idx" ON "PaymentAttempt"("livemode", "status");

-- CreateIndex
CREATE INDEX "Settlement_livemode_status_createdAt_idx" ON "Settlement"("livemode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutCoordination_livemode_status_idx" ON "PayoutCoordination"("livemode", "status");

-- CreateIndex
CREATE INDEX "TreasuryLedgerEntry_livemode_currency_status_idx" ON "TreasuryLedgerEntry"("livemode", "currency", "status");

-- CreateIndex
CREATE INDEX "RevenuePayout_livemode_status_idx" ON "RevenuePayout"("livemode", "status");

-- CreateIndex
CREATE INDEX "OrchestrationMeteringLedger_livemode_createdAt_idx" ON "OrchestrationMeteringLedger"("livemode", "createdAt");
