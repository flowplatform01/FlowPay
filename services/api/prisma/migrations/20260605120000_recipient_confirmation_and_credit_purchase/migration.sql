-- Recipient confirmation governance (DestinationProfile)
-- Columns may already exist if schema was pushed manually during development.
ALTER TABLE "DestinationProfile" ADD COLUMN IF NOT EXISTS "confirmationToken" TEXT;
ALTER TABLE "DestinationProfile" ADD COLUMN IF NOT EXISTS "confirmationTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "DestinationProfile" ADD COLUMN IF NOT EXISTS "confirmationRequestedAt" TIMESTAMP(3);

-- Developer self-service credit purchase intents
DO $$ BEGIN
  CREATE TYPE "CreditPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CreditPurchaseIntent" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "amountXaf" DECIMAL(18,2) NOT NULL,
  "creditAmountApplied" DECIMAL(18,2),
  "status" "CreditPurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "transactionId" TEXT,
  "failureReason" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreditPurchaseIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditPurchaseIntent_externalReference_key" ON "CreditPurchaseIntent"("externalReference");
CREATE INDEX IF NOT EXISTS "CreditPurchaseIntent_appId_status_idx" ON "CreditPurchaseIntent"("appId", "status");
CREATE INDEX IF NOT EXISTS "CreditPurchaseIntent_transactionId_idx" ON "CreditPurchaseIntent"("transactionId");
CREATE INDEX IF NOT EXISTS "CreditPurchaseIntent_externalReference_idx" ON "CreditPurchaseIntent"("externalReference");

DO $$ BEGIN
  ALTER TABLE "CreditPurchaseIntent"
    ADD CONSTRAINT "CreditPurchaseIntent_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
