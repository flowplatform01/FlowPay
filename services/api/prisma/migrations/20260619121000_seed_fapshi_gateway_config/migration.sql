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
VALUES (
  'gateway_fapshi_default',
  'FAPSHI',
  'Fapshi',
  true,
  'https://live.fapshi.com',
  'FAPSHI_API_USER_ENV',
  'FAPSHI_API_KEY_ENV',
  '{"mode":"live","routeStrategy":"primary","providerFeeFlatAmount":0,"providerFeePercentageRate":0,"providerPayoutFeeFlatAmount":0,"providerPayoutFeePercentageRate":0,"capabilities":["LOCAL_MOMO_COLLECTION","MTN_COLLECTION","ORANGE_COLLECTION","CAMEROON_ROUTING","REGIONAL_DISBURSEMENT","MOBILE_FIRST_COLLECTION"]}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "baseUrl" = EXCLUDED."baseUrl",
  "metadata" = COALESCE("GatewayConfig"."metadata", EXCLUDED."metadata"),
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "GatewayHealth" (
  "id",
  "provider",
  "status",
  "latencyMs",
  "lastCheckedAt",
  "gatewayConfigId",
  "createdAt",
  "updatedAt"
)
VALUES (
  'gateway_health_fapshi_default',
  'FAPSHI',
  'healthy',
  NULL,
  CURRENT_TIMESTAMP,
  (SELECT "id" FROM "GatewayConfig" WHERE "provider" = 'FAPSHI'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider") DO UPDATE SET
  "status" = EXCLUDED."status",
  "lastCheckedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP;
