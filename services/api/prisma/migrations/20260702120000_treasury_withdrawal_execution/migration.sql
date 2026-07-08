-- Adds execution controls for platform-owned FlowPay treasury withdrawals.

ALTER TABLE "TreasuryWithdrawal"
  ADD COLUMN "provider" "GatewayProvider",
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerReference" TEXT,
  ADD COLUMN "requestPayload" JSONB,
  ADD COLUMN "responsePayload" JSONB;

UPDATE "TreasuryWithdrawal"
SET "idempotencyKey" = CONCAT('treasury-withdrawal:', "id")
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "TreasuryWithdrawal"
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "TreasuryWithdrawal_idempotencyKey_key" ON "TreasuryWithdrawal"("idempotencyKey");
CREATE INDEX "TreasuryWithdrawal_provider_status_idx" ON "TreasuryWithdrawal"("provider", "status");
