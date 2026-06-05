-- Hardening constraints for payment finality, webhook idempotency, and operations queries.

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_gatewayReference_unique_not_null"
  ON "PaymentAttempt"("gatewayReference")
  WHERE "gatewayReference" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookLog_provider_requestId_unique_not_null"
  ON "WebhookLog"("provider", "requestId")
  WHERE "requestId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Transaction_status_createdAt_idx"
  ON "Transaction"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Settlement_transactionId_status_idx"
  ON "Settlement"("transactionId", "status");

