-- FlowPay production orchestration foundation.

CREATE TYPE "OrchestrationMode" AS ENUM ('PLATFORM_REVENUE', 'MULTI_TENANT');
CREATE TYPE "SettlementStrategy" AS ENUM ('TWO_STEP_MIRROR', 'NATIVE_SPLIT');
CREATE TYPE "DestinationVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "PayoutCoordinationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "OrchestrationMeterEventType" AS ENUM ('PAYMENT_INTENT_INITIALIZED', 'PAYMENT_CAPTURED', 'PAYOUT_COORDINATED', 'SETTLEMENT_RECONCILED');

ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'COLLECTED_PENDING_PAYOUT';

ALTER TABLE "App"
  ADD COLUMN "orchestrationCredits" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "processingUnits" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "infrastructureUsageBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;

UPDATE "App"
SET
  "orchestrationCredits" = 100000,
  "processingUnits" = 100000,
  "infrastructureUsageBalance" = 100000
WHERE "deletedAt" IS NULL;

CREATE TABLE "DestinationProfile" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalRecipientId" TEXT NOT NULL,
  "providerType" "GatewayProvider" NOT NULL,
  "payoutTarget" TEXT NOT NULL,
  "nativeSubaccountId" TEXT,
  "settlementStrategy" "SettlementStrategy" NOT NULL DEFAULT 'TWO_STEP_MIRROR',
  "providerMetadata" JSONB,
  "verificationStatus" "DestinationVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "supportedRails" JSONB,
  "regionalCurrency" TEXT NOT NULL,
  "routingPreferences" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "DestinationProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction"
  ADD COLUMN "destinationProfileId" TEXT,
  ADD COLUMN "externalRecipientId" TEXT,
  ADD COLUMN "orchestrationMode" "OrchestrationMode" NOT NULL DEFAULT 'PLATFORM_REVENUE',
  ADD COLUMN "settlementStrategy" "SettlementStrategy" NOT NULL DEFAULT 'TWO_STEP_MIRROR';

CREATE TABLE "PayoutCoordination" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "destinationProfileId" TEXT,
  "provider" "GatewayProvider" NOT NULL,
  "status" "PayoutCoordinationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" TIMESTAMP(3),
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayoutCoordination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationMeteringLedger" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "transactionId" TEXT,
  "eventType" "OrchestrationMeterEventType" NOT NULL,
  "processingUnits" DECIMAL(18,2) NOT NULL,
  "orchestrationCredits" DECIMAL(18,2) NOT NULL,
  "infrastructureUsageBalanceBefore" DECIMAL(18,2) NOT NULL,
  "infrastructureUsageBalanceAfter" DECIMAL(18,2) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrchestrationMeteringLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DestinationProfile_appId_externalRecipientId_key" ON "DestinationProfile"("appId", "externalRecipientId");
CREATE INDEX "DestinationProfile_organizationId_providerType_verificationStatus_idx" ON "DestinationProfile"("organizationId", "providerType", "verificationStatus");
CREATE INDEX "DestinationProfile_settlementStrategy_verificationStatus_idx" ON "DestinationProfile"("settlementStrategy", "verificationStatus");

CREATE INDEX "Transaction_appId_externalRecipientId_idx" ON "Transaction"("appId", "externalRecipientId");
CREATE INDEX "Transaction_destinationProfileId_status_idx" ON "Transaction"("destinationProfileId", "status");

CREATE UNIQUE INDEX "PayoutCoordination_idempotencyKey_key" ON "PayoutCoordination"("idempotencyKey");
CREATE INDEX "PayoutCoordination_transactionId_status_idx" ON "PayoutCoordination"("transactionId", "status");
CREATE INDEX "PayoutCoordination_provider_status_idx" ON "PayoutCoordination"("provider", "status");

CREATE INDEX "OrchestrationMeteringLedger_appId_createdAt_idx" ON "OrchestrationMeteringLedger"("appId", "createdAt");
CREATE INDEX "OrchestrationMeteringLedger_transactionId_eventType_idx" ON "OrchestrationMeteringLedger"("transactionId", "eventType");

ALTER TABLE "DestinationProfile" ADD CONSTRAINT "DestinationProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DestinationProfile" ADD CONSTRAINT "DestinationProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destinationProfileId_fkey" FOREIGN KEY ("destinationProfileId") REFERENCES "DestinationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayoutCoordination" ADD CONSTRAINT "PayoutCoordination_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutCoordination" ADD CONSTRAINT "PayoutCoordination_destinationProfileId_fkey" FOREIGN KEY ("destinationProfileId") REFERENCES "DestinationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrchestrationMeteringLedger" ADD CONSTRAINT "OrchestrationMeteringLedger_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrchestrationMeteringLedger" ADD CONSTRAINT "OrchestrationMeteringLedger_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
