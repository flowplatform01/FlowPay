-- Gateway-aware treasury accounting and optional treasury-funded app credit refill.

ALTER TYPE "TreasuryLedgerEntryType" ADD VALUE IF NOT EXISTS 'APP_CREDIT_REFILL';

ALTER TABLE "App"
  ADD COLUMN IF NOT EXISTS "autoCreditRefillEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoCreditRefillThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autoCreditRefillAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autoCreditRefillProvider" "GatewayProvider";

ALTER TABLE "TreasuryLedgerEntry"
  ADD COLUMN IF NOT EXISTS "provider" "GatewayProvider";

UPDATE "TreasuryLedgerEntry" ledger
SET "provider" = tx."selectedProvider"
FROM "Transaction" tx
WHERE ledger."sourceTransactionId" = tx."id"
  AND ledger."provider" IS NULL;

UPDATE "TreasuryLedgerEntry" ledger
SET "provider" = withdrawal."provider"
FROM "TreasuryWithdrawal" withdrawal
WHERE ledger."sourceWithdrawalId" = withdrawal."id"
  AND withdrawal."provider" IS NOT NULL
  AND ledger."provider" IS NULL;

UPDATE "TreasuryLedgerEntry"
SET "provider" = ("metadata"->>'provider')::"GatewayProvider"
WHERE "provider" IS NULL
  AND "metadata" ? 'provider'
  AND "metadata"->>'provider' IN (
    'CAMPAY',
    'MAVIANCE',
    'CINETPAY',
    'FLUTTERWAVE',
    'MONETBIL',
    'FAPSHI'
  );

CREATE INDEX IF NOT EXISTS "TreasuryLedgerEntry_provider_currency_status_idx"
  ON "TreasuryLedgerEntry"("provider", "currency", "status");

CREATE INDEX IF NOT EXISTS "TreasuryLedgerEntry_provider_entryType_createdAt_idx"
  ON "TreasuryLedgerEntry"("provider", "entryType", "createdAt");
