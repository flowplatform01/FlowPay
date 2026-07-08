-- CreateEnum
CREATE TYPE "RevenuePayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "App" ADD COLUMN "recipientVerificationPaymentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "App" ADD COLUMN "recipientVerificationAmountXaf" DECIMAL(18,2) NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "RevenuePayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payoutDestinationId" TEXT,
    "provider" "GatewayProvider" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RevenuePayoutStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenuePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenuePayout_idempotencyKey_key" ON "RevenuePayout"("idempotencyKey");
CREATE INDEX "RevenuePayout_organizationId_status_idx" ON "RevenuePayout"("organizationId", "status");
CREATE INDEX "RevenuePayout_provider_status_idx" ON "RevenuePayout"("provider", "status");

-- AddForeignKey
ALTER TABLE "RevenuePayout" ADD CONSTRAINT "RevenuePayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RevenuePayout" ADD CONSTRAINT "RevenuePayout_payoutDestinationId_fkey" FOREIGN KEY ("payoutDestinationId") REFERENCES "PayoutDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
