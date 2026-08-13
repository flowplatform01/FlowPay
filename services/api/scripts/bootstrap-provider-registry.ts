import "dotenv/config";
import { GatewayProvider, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ProviderBootstrap = {
  provider: GatewayProvider;
  displayName: string;
  baseUrl: string;
  publicKeyPlaceholder: string;
  secretKeyPlaceholder: string;
  capabilities: string[];
};

const providers: ProviderBootstrap[] = [
  {
    provider: GatewayProvider.CAMPAY,
    displayName: "CamPay",
    baseUrl: "https://www.campay.net",
    publicKeyPlaceholder: "CAMPAY_PUBLIC_KEY_ENV",
    secretKeyPlaceholder: "CAMPAY_SECRET_KEY_ENV",
    capabilities: ["LOCAL_MOMO_COLLECTION", "MTN_COLLECTION", "ORANGE_COLLECTION", "CAMEROON_ROUTING"]
  },
  {
    provider: GatewayProvider.FAPSHI,
    displayName: "Fapshi",
    baseUrl: "https://live.fapshi.com",
    publicKeyPlaceholder: "FAPSHI_API_USER_ENV",
    secretKeyPlaceholder: "FAPSHI_API_KEY_ENV",
    capabilities: [
      "LOCAL_MOMO_COLLECTION",
      "MTN_COLLECTION",
      "ORANGE_COLLECTION",
      "CAMEROON_ROUTING",
      "REGIONAL_DISBURSEMENT",
      "MOBILE_FIRST_COLLECTION",
      "MOBILE_MONEY_PAYOUT"
    ]
  },
  {
    provider: GatewayProvider.MAVIANCE,
    displayName: "Maviance",
    baseUrl: "https://api.maviance.com",
    publicKeyPlaceholder: "MAVIANCE_PUBLIC_KEY_ENV",
    secretKeyPlaceholder: "MAVIANCE_SECRET_KEY_ENV",
    capabilities: [
      "BANK_RAILS",
      "GIMAC_INTEROPERABILITY",
      "ENTERPRISE_UTILITY_EXECUTION",
      "LOCAL_MOMO_COLLECTION",
      "CAMEROON_ROUTING"
    ]
  },
  {
    provider: GatewayProvider.CINETPAY,
    displayName: "CinetPay",
    baseUrl: "https://api-checkout.cinetpay.com",
    publicKeyPlaceholder: "CINETPAY_PUBLIC_KEY_ENV",
    secretKeyPlaceholder: "CINETPAY_SECRET_KEY_ENV",
    capabilities: ["FRANCOPHONE_REGIONAL_ROUTING", "REGIONAL_DISBURSEMENT", "CARD_PAYMENTS", "LOCAL_MOMO_COLLECTION"]
  },
  {
    provider: GatewayProvider.FLUTTERWAVE,
    displayName: "Flutterwave",
    baseUrl: "https://api.flutterwave.com",
    publicKeyPlaceholder: "FLUTTERWAVE_PUBLIC_KEY_ENV",
    secretKeyPlaceholder: "FLUTTERWAVE_SECRET_KEY_ENV",
    capabilities: ["SUBACCOUNTS", "CARD_PAYMENTS", "BANK_RAILS", "PAN_AFRICAN_ROUTING", "NATIVE_SPLIT_SETTLEMENT"]
  },
  {
    provider: GatewayProvider.MONETBIL,
    displayName: "Monetbil",
    baseUrl: "https://api.monetbil.com",
    publicKeyPlaceholder: "MONETBIL_SERVICE_KEY_ENV",
    secretKeyPlaceholder: "MONETBIL_SERVICE_SECRET_ENV",
    capabilities: ["LOCAL_MOMO_COLLECTION", "TELECOM_FALLBACK", "MOBILE_FIRST_COLLECTION", "CAMEROON_ROUTING"]
  }
];

try {
  for (const provider of providers) {
    const existing = await prisma.gatewayConfig.findUnique({
      where: { provider: provider.provider },
      select: { id: true, isEnabled: true, metadata: true }
    });

    const config = await prisma.gatewayConfig.upsert({
      where: { provider: provider.provider },
      update: {},
      create: {
        provider: provider.provider,
        displayName: provider.displayName,
        isEnabled: false,
        baseUrl: provider.baseUrl,
        encryptedPublicKey: provider.publicKeyPlaceholder,
        encryptedSecretKey: provider.secretKeyPlaceholder,
        metadata: {
          mode: "live",
          routeStrategy: "standby",
          providerFeeFlatAmount: 0,
          providerFeePercentageRate: 0,
          providerPayoutFeeFlatAmount: 0,
          providerPayoutFeePercentageRate: 0,
          capabilities: provider.capabilities
        }
      }
    });

    await prisma.gatewayHealth.upsert({
      where: { provider: provider.provider },
      update: {},
      create: {
        provider: provider.provider,
        status: existing?.isEnabled ? "healthy" : "offline",
        latencyMs: null,
        lastCheckedAt: new Date(),
        errorMessage: existing?.isEnabled ? null : "Provider registered but not yet enabled",
        gatewayConfigId: config.id
      }
    });
  }

  const rows = await prisma.gatewayConfig.findMany({
    select: { provider: true, isEnabled: true },
    orderBy: { provider: "asc" }
  });

  console.log(`Provider registry contains ${rows.length} provider(s): ${rows.map((row) => row.provider).join(", ")}`);
} finally {
  await prisma.$disconnect();
}
