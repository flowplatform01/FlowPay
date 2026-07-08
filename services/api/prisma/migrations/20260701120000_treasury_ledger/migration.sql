-- Central FlowPay treasury ledger.
-- Balances are derived from immutable ledger entries, not stored in a mutable balance table.

CREATE TYPE "TreasuryLedgerEntryType" AS ENUM (
  'PLATFORM_FEE_CAPTURED',
  'WITHDRAWAL_RESERVED',
  'WITHDRAWAL_EXECUTED',
  'WITHDRAWAL_REVERSED',
  'ADJUSTMENT'
);

CREATE TYPE "TreasuryLedgerDirection" AS ENUM (
  'CREDIT',
  'DEBIT'
);

CREATE TYPE "TreasuryLedgerStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'SETTLED',
  'VOID'
);

CREATE TYPE "TreasuryWithdrawalStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "TreasuryWithdrawal" (
  "id" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "TreasuryWithdrawalStatus" NOT NULL DEFAULT 'DRAFT',
  "destinationType" TEXT NOT NULL,
  "destinationRef" TEXT NOT NULL,
  "requestedBy" TEXT,
  "approvedBy" TEXT,
  "processedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TreasuryWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreasuryLedgerEntry" (
  "id" TEXT NOT NULL,
  "entryType" "TreasuryLedgerEntryType" NOT NULL,
  "direction" "TreasuryLedgerDirection" NOT NULL,
  "status" "TreasuryLedgerStatus" NOT NULL DEFAULT 'AVAILABLE',
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "sourceTransactionId" TEXT,
  "sourceWithdrawalId" TEXT,
  "reference" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryLedgerEntry_reference_key" ON "TreasuryLedgerEntry"("reference");
CREATE UNIQUE INDEX "TreasuryLedgerEntry_sourceTransactionId_entryType_key" ON "TreasuryLedgerEntry"("sourceTransactionId", "entryType");
CREATE INDEX "TreasuryLedgerEntry_currency_status_createdAt_idx" ON "TreasuryLedgerEntry"("currency", "status", "createdAt");
CREATE INDEX "TreasuryLedgerEntry_entryType_createdAt_idx" ON "TreasuryLedgerEntry"("entryType", "createdAt");
CREATE INDEX "TreasuryLedgerEntry_sourceWithdrawalId_idx" ON "TreasuryLedgerEntry"("sourceWithdrawalId");
CREATE INDEX "TreasuryWithdrawal_currency_status_createdAt_idx" ON "TreasuryWithdrawal"("currency", "status", "createdAt");

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_sourceTransactionId_fkey"
  FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_sourceWithdrawalId_fkey"
  FOREIGN KEY ("sourceWithdrawalId") REFERENCES "TreasuryWithdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
