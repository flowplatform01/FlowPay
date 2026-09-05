-- App-facing Mode 1 revenue payouts must be owned by the calling app, not only
-- by the parent organization. Existing rows are backfilled from metadata so
-- production payout status/balance checks remain compatible after migration.
ALTER TABLE "RevenuePayout" ADD COLUMN "appId" TEXT;

UPDATE "RevenuePayout"
SET "appId" = "metadata"->>'appId'
WHERE "appId" IS NULL
  AND "metadata" IS NOT NULL
  AND "metadata" ? 'appId';

ALTER TABLE "RevenuePayout"
ADD CONSTRAINT "RevenuePayout_appId_fkey"
FOREIGN KEY ("appId") REFERENCES "App"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RevenuePayout_appId_status_idx" ON "RevenuePayout"("appId", "status");
CREATE INDEX "RevenuePayout_appId_currency_status_idx" ON "RevenuePayout"("appId", "currency", "status");
