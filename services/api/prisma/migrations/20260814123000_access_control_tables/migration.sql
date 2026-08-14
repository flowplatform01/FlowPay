-- Backfill schema objects that protect organization/app provider access.
-- This migration is intentionally idempotent because older development
-- databases may already have these tables from prisma db push/manual sync.

CREATE TABLE IF NOT EXISTS "AppProviderAccess" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "provider" "GatewayProvider" NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppProviderAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AppCapabilityGrant" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppCapabilityGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganizationProviderAccess" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "GatewayProvider" NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganizationProviderAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppProviderAccess_appId_provider_key"
  ON "AppProviderAccess"("appId", "provider");
CREATE INDEX IF NOT EXISTS "AppProviderAccess_provider_isEnabled_idx"
  ON "AppProviderAccess"("provider", "isEnabled");

CREATE UNIQUE INDEX IF NOT EXISTS "AppCapabilityGrant_appId_capability_key"
  ON "AppCapabilityGrant"("appId", "capability");
CREATE INDEX IF NOT EXISTS "AppCapabilityGrant_capability_isEnabled_idx"
  ON "AppCapabilityGrant"("capability", "isEnabled");

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationProviderAccess_organizationId_provider_key"
  ON "OrganizationProviderAccess"("organizationId", "provider");
CREATE INDEX IF NOT EXISTS "OrganizationProviderAccess_provider_isEnabled_idx"
  ON "OrganizationProviderAccess"("provider", "isEnabled");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AppProviderAccess_appId_fkey'
  ) THEN
    ALTER TABLE "AppProviderAccess"
      ADD CONSTRAINT "AppProviderAccess_appId_fkey"
      FOREIGN KEY ("appId") REFERENCES "App"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AppCapabilityGrant_appId_fkey'
  ) THEN
    ALTER TABLE "AppCapabilityGrant"
      ADD CONSTRAINT "AppCapabilityGrant_appId_fkey"
      FOREIGN KEY ("appId") REFERENCES "App"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationProviderAccess_organizationId_fkey'
  ) THEN
    ALTER TABLE "OrganizationProviderAccess"
      ADD CONSTRAINT "OrganizationProviderAccess_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "OrganizationProviderAccess" ("id", "organizationId", "provider", "isEnabled", "createdAt", "updatedAt")
SELECT
  'orgpa_' || md5(o."id" || provider::text),
  o."id",
  provider,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN unnest(enum_range(NULL::"GatewayProvider")) AS provider
ON CONFLICT ("organizationId", "provider") DO NOTHING;

INSERT INTO "AppProviderAccess" ("id", "appId", "provider", "isEnabled", "priority", "createdAt", "updatedAt")
SELECT
  'apppa_' || md5(a."id" || provider::text),
  a."id",
  provider,
  true,
  CASE provider
    WHEN 'FAPSHI' THEN 10
    WHEN 'CAMPAY' THEN 20
    ELSE 100
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "App" a
CROSS JOIN unnest(enum_range(NULL::"GatewayProvider")) AS provider
ON CONFLICT ("appId", "provider") DO NOTHING;

INSERT INTO "AppCapabilityGrant" ("id", "appId", "capability", "isEnabled", "createdAt", "updatedAt")
SELECT
  'appcap_' || md5(a."id" || capability),
  a."id",
  capability,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "App" a
CROSS JOIN unnest(ARRAY['PAYIN', 'PAYOUT', 'RECIPIENT_PROFILE']) AS capability
ON CONFLICT ("appId", "capability") DO NOTHING;
