-- Capacity & Eligibility Policy System (generalized; RECIPIENT seeded first)

CREATE TYPE "CapacityResourceType" AS ENUM ('RECIPIENT');

CREATE TABLE "CapacityPolicyDefinition" (
  "id" TEXT NOT NULL,
  "resourceType" "CapacityResourceType" NOT NULL,
  "enforcementEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CapacityPolicyDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapacityPolicyDefinition_resourceType_key" ON "CapacityPolicyDefinition"("resourceType");

CREATE TABLE "CapacityPolicyTier" (
  "id" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "tierKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "maxCapacity" INTEGER,
  "minEffectiveCredit" DECIMAL(18,2) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CapacityPolicyTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapacityPolicyTier_definitionId_tierKey_key" ON "CapacityPolicyTier"("definitionId", "tierKey");
CREATE INDEX "CapacityPolicyTier_definitionId_sortOrder_idx" ON "CapacityPolicyTier"("definitionId", "sortOrder");

ALTER TABLE "CapacityPolicyTier"
  ADD CONSTRAINT "CapacityPolicyTier_definitionId_fkey"
  FOREIGN KEY ("definitionId") REFERENCES "CapacityPolicyDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppCapacityPolicyOverride" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "resourceType" "CapacityResourceType" NOT NULL,
  "enforcementDisabled" BOOLEAN NOT NULL DEFAULT false,
  "maxCapacityOverride" INTEGER,
  "minEffectiveCreditOverride" DECIMAL(18,2),
  "unlimitedCapacityGranted" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppCapacityPolicyOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppCapacityPolicyOverride_appId_resourceType_key" ON "AppCapacityPolicyOverride"("appId", "resourceType");

ALTER TABLE "AppCapacityPolicyOverride"
  ADD CONSTRAINT "AppCapacityPolicyOverride_appId_fkey"
  FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default RECIPIENT policy tiers (platform defaults; admin-configurable)
INSERT INTO "CapacityPolicyDefinition" ("id", "resourceType", "enforcementEnabled", "createdAt", "updatedAt")
VALUES ('capdef_recipient_default', 'RECIPIENT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("resourceType") DO NOTHING;

INSERT INTO "CapacityPolicyTier" (
  "id", "definitionId", "tierKey", "name", "description", "sortOrder", "maxCapacity", "minEffectiveCredit", "enabled", "createdAt", "updatedAt"
) VALUES
  ('captier_recipient_1', 'capdef_recipient_default', 'tier_1', 'Starter', 'Single recipient operations', 1, 1, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('captier_recipient_2', 'capdef_recipient_default', 'tier_2', 'Growth', 'Small recipient portfolio', 2, 5, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('captier_recipient_3', 'capdef_recipient_default', 'tier_3', 'Scale', 'Mid-size recipient portfolio', 3, 20, 200, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('captier_recipient_4', 'capdef_recipient_default', 'tier_4', 'Enterprise', 'Large recipient portfolio', 4, 100, 1000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('captier_recipient_5', 'capdef_recipient_default', 'tier_5', 'Platform', 'Unlimited recipients within admin cap', 5, NULL, 5000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("definitionId", "tierKey") DO NOTHING;
