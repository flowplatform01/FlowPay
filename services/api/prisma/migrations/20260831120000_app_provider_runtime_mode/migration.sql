CREATE TYPE "GatewayRuntimeMode" AS ENUM ('SANDBOX', 'LIVE');

ALTER TABLE "AppProviderAccess" ADD COLUMN "runtimeMode" "GatewayRuntimeMode";
ALTER TABLE "OrganizationProviderAccess" ADD COLUMN "runtimeMode" "GatewayRuntimeMode";
