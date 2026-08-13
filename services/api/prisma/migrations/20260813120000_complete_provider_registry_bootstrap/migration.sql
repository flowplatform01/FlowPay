-- Ensure a clean production database has the full FlowPay provider registry.
--
-- Earlier production-safe migrations register FAPSHI plus inactive future
-- providers. Local/dev databases also had CAMPAY, MAVIANCE, and CINETPAY from
-- seed data, but production deployments should not depend on demo seeds.
-- These rows are registered as disabled standby routes until an administrator
-- configures credentials and explicitly enables traffic.

INSERT INTO "GatewayConfig" (
  "id",
  "provider",
  "displayName",
  "isEnabled",
  "baseUrl",
  "encryptedPublicKey",
  "encryptedSecretKey",
  "metadata",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'gateway_campay_default',
    'CAMPAY',
    'CamPay',
    false,
    'https://www.campay.net',
    'CAMPAY_PUBLIC_KEY_ENV',
    'CAMPAY_SECRET_KEY_ENV',
    '{"mode":"live","routeStrategy":"standby","providerFeeFlatAmount":0,"providerFeePercentageRate":0,"providerPayoutFeeFlatAmount":0,"providerPayoutFeePercentageRate":0,"capabilities":["LOCAL_MOMO_COLLECTION","MTN_COLLECTION","ORANGE_COLLECTION","CAMEROON_ROUTING"]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'gateway_maviance_default',
    'MAVIANCE',
    'Maviance',
    false,
    'https://api.maviance.com',
    'MAVIANCE_PUBLIC_KEY_ENV',
    'MAVIANCE_SECRET_KEY_ENV',
    '{"mode":"live","routeStrategy":"standby","providerFeeFlatAmount":0,"providerFeePercentageRate":0,"providerPayoutFeeFlatAmount":0,"providerPayoutFeePercentageRate":0,"capabilities":["BANK_RAILS","GIMAC_INTEROPERABILITY","ENTERPRISE_UTILITY_EXECUTION","LOCAL_MOMO_COLLECTION","CAMEROON_ROUTING"]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'gateway_cinetpay_default',
    'CINETPAY',
    'CinetPay',
    false,
    'https://api-checkout.cinetpay.com',
    'CINETPAY_PUBLIC_KEY_ENV',
    'CINETPAY_SECRET_KEY_ENV',
    '{"mode":"live","routeStrategy":"standby","providerFeeFlatAmount":0,"providerFeePercentageRate":0,"providerPayoutFeeFlatAmount":0,"providerPayoutFeePercentageRate":0,"capabilities":["FRANCOPHONE_REGIONAL_ROUTING","REGIONAL_DISBURSEMENT","CARD_PAYMENTS","LOCAL_MOMO_COLLECTION"]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("provider") DO NOTHING;

INSERT INTO "GatewayHealth" (
  "id",
  "provider",
  "status",
  "latencyMs",
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
  NULL,
  CURRENT_TIMESTAMP,
  'Provider registered but not yet enabled',
  gc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "GatewayConfig" gc
WHERE gc."provider" IN ('CAMPAY', 'MAVIANCE', 'CINETPAY')
ON CONFLICT ("provider") DO NOTHING;
