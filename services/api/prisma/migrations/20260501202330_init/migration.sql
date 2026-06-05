-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('PUBLIC', 'SECRET', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'SENT_TO_GATEWAY', 'PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('CAMPAY', 'MAVIANCE', 'CINETPAY');

-- CreateEnum
CREATE TYPE "RetryJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeeRuleType" AS ENUM ('FLAT', 'PERCENTAGE', 'HYBRID', 'DYNAMIC');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "settlementCurrency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "AppStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "appPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "type" "ApiKeyType" NOT NULL,
    "label" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayConfig" (
    "id" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT NOT NULL,
    "encryptedPublicKey" TEXT,
    "encryptedSecretKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayHealth" (
    "id" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,
    "gatewayConfigId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FeeRuleType" NOT NULL,
    "flatAmount" DECIMAL(18,2),
    "percentageRate" DECIMAL(8,4),
    "dynamicConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutDestination" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationRef" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "gatewayFeeAmount" DECIMAL(18,2) NOT NULL,
    "platformFeeAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "settlementAmount" DECIMAL(18,2) NOT NULL,
    "settlementDestinationId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "selectedProvider" "GatewayProvider" NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "gatewayConfigId" TEXT NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "gatewayReference" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionEvent" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payoutDestinationId" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "gatewayFeeAmount" DECIMAL(18,2) NOT NULL,
    "platformFeeAmount" DECIMAL(18,2) NOT NULL,
    "settlementAmount" DECIMAL(18,2) NOT NULL,
    "destinationSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "provider" "GatewayProvider" NOT NULL,
    "requestId" TEXT,
    "signature" TEXT,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetryJob" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "queueName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RetryJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "App_slug_key" ON "App"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "App_clientId_key" ON "App"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "App_appPublicKey_key" ON "App"("appPublicKey");

-- CreateIndex
CREATE INDEX "App_organizationId_status_idx" ON "App"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApiKey_appId_type_idx" ON "ApiKey"("appId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayConfig_provider_key" ON "GatewayConfig"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayHealth_provider_key" ON "GatewayHealth"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayHealth_gatewayConfigId_key" ON "GatewayHealth"("gatewayConfigId");

-- CreateIndex
CREATE INDEX "Transaction_externalReference_status_idx" ON "Transaction"("externalReference", "status");

-- CreateIndex
CREATE INDEX "Transaction_organizationId_createdAt_idx" ON "Transaction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_selectedProvider_status_idx" ON "Transaction"("selectedProvider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_appId_idempotencyKey_key" ON "Transaction"("appId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_transactionId_status_idx" ON "PaymentAttempt"("transactionId", "status");

-- CreateIndex
CREATE INDEX "TransactionEvent_transactionId_createdAt_idx" ON "TransactionEvent"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_status_idx" ON "Settlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_createdAt_idx" ON "WebhookLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "RetryJob_queueName_status_idx" ON "RetryJob"("queueName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayHealth" ADD CONSTRAINT "GatewayHealth_gatewayConfigId_fkey" FOREIGN KEY ("gatewayConfigId") REFERENCES "GatewayConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutDestination" ADD CONSTRAINT "PayoutDestination_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_gatewayConfigId_fkey" FOREIGN KEY ("gatewayConfigId") REFERENCES "GatewayConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionEvent" ADD CONSTRAINT "TransactionEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_payoutDestinationId_fkey" FOREIGN KEY ("payoutDestinationId") REFERENCES "PayoutDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetryJob" ADD CONSTRAINT "RetryJob_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
