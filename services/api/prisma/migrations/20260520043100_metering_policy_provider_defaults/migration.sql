-- Add explicit app-level metering policy and register inactive future providers.

ALTER TABLE "App"
  ADD COLUMN IF NOT EXISTS "mode1MeteringEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mode2MeteringEnabled" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "GatewayConfig" (
  "id",
  "provider",
  "displayName",
  "isEnabled",
  "baseUrl",
  "metadata",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'gateway_flutterwave_default',
    'FLUTTERWAVE',
    'Flutterwave',
    false,
    'https://api.flutterwave.com',
    '{"mode":"sandbox","routeStrategy":"standby","capabilities":["SUBACCOUNTS","CARD_PAYMENTS","BANK_RAILS","PAN_AFRICAN_ROUTING","NATIVE_SPLIT_SETTLEMENT"],"settlementModels":["NATIVE_SPLIT"]}'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'gateway_monetbil_default',
    'MONETBIL',
    'Monetbil',
    false,
    'https://api.monetbil.com',
    '{"mode":"sandbox","routeStrategy":"standby","capabilities":["LOCAL_MOMO_COLLECTION","TELECOM_FALLBACK","MOBILE_FIRST_COLLECTION","CAMEROON_ROUTING"],"settlementModels":["TWO_STEP_MIRROR"]}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("provider") DO NOTHING;

INSERT INTO "GatewayHealth" (
  "id",
  "provider",
  "status",
  "lastCheckedAt",
  "errorMessage",
  "gatewayConfigId",
  "createdAt",
  "updatedAt"
)
SELECT
  'health_' || lower(gc."provider"::text) || '_default',
  gc."provider",
  'offline',
  NOW(),
  'Provider registered but not yet enabled',
  gc."id",
  NOW(),
  NOW()
FROM "GatewayConfig" gc
WHERE gc."provider" IN ('FLUTTERWAVE', 'MONETBIL')
ON CONFLICT ("provider") DO NOTHING;
