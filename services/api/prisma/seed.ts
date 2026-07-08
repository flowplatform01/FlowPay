import crypto from "node:crypto";
import dotenv from "dotenv";
import { PrismaClient, FeeRuleType, GatewayProvider } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function providerCapabilities(provider: GatewayProvider) {
  const capabilities: Record<GatewayProvider, string[]> = {
    [GatewayProvider.CAMPAY]: ["LOCAL_MOMO_COLLECTION", "MTN_COLLECTION", "ORANGE_COLLECTION", "CAMEROON_ROUTING"],
    [GatewayProvider.FAPSHI]: [
      "LOCAL_MOMO_COLLECTION",
      "MTN_COLLECTION",
      "ORANGE_COLLECTION",
      "CAMEROON_ROUTING",
      "REGIONAL_DISBURSEMENT",
      "MOBILE_FIRST_COLLECTION",
      "MOBILE_MONEY_PAYOUT"
    ],
    [GatewayProvider.MAVIANCE]: [
      "BANK_RAILS",
      "GIMAC_INTEROPERABILITY",
      "ENTERPRISE_UTILITY_EXECUTION",
      "LOCAL_MOMO_COLLECTION",
      "CAMEROON_ROUTING"
    ],
    [GatewayProvider.CINETPAY]: [
      "FRANCOPHONE_REGIONAL_ROUTING",
      "REGIONAL_DISBURSEMENT",
      "CARD_PAYMENTS",
      "LOCAL_MOMO_COLLECTION"
    ],
    [GatewayProvider.FLUTTERWAVE]: [
      "SUBACCOUNTS",
      "CARD_PAYMENTS",
      "BANK_RAILS",
      "PAN_AFRICAN_ROUTING",
      "NATIVE_SPLIT_SETTLEMENT"
    ],
    [GatewayProvider.MONETBIL]: [
      "LOCAL_MOMO_COLLECTION",
      "TELECOM_FALLBACK",
      "MOBILE_FIRST_COLLECTION",
      "CAMEROON_ROUTING"
    ]
  };

  return capabilities[provider];
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "campus-demo" },
    update: {},
    create: {
      name: "Campus Demo Schools",
      slug: "campus-demo",
      countryCode: "CM",
      settlementCurrency: "XAF"
    }
  });

  const app = await prisma.app.upsert({
    where: { slug: "campus" },
    update: {},
    create: {
      name: "Campus",
      slug: "campus",
      organizationId: organization.id,
      clientId: "campus-client",
      clientSecretHash: hashSecret("campus-client-secret"),
      appPublicKey: "fpub_demo_campus",
      webhookUrl: "https://campus.flow.local/webhooks/flowpay"
    }
  });

  await prisma.apiKey.createMany({
    data: [
      { appId: app.id, type: "PUBLIC", label: "Public key", hashedKey: hashSecret("fpub_demo_campus") },
      { appId: app.id, type: "SECRET", label: "Secret key", hashedKey: hashSecret("fsec_demo_campus_secret") },
      { appId: app.id, type: "WEBHOOK", label: "Webhook secret", hashedKey: hashSecret("fwhsec_demo_campus") }
    ],
    skipDuplicates: true
  });

  for (const capability of ["PAYIN", "WEBHOOKS", "REFUNDS", "MANUAL_REVIEW"]) {
    await prisma.appCapabilityGrant.upsert({
      where: {
        appId_capability: {
          appId: app.id,
          capability
        }
      },
      update: {
        isEnabled: true
      },
      create: {
        appId: app.id,
        capability,
        isEnabled: true
      }
    });
  }

  const payoutDestination =
    (await prisma.payoutDestination.findFirst({
      where: { organizationId: organization.id, isDefault: true }
    })) ??
    (await prisma.payoutDestination.create({
      data: {
        organizationId: organization.id,
        label: "Primary School MoMo",
        destinationType: "mobile_money",
        destinationRef: "237670000000",
        currency: "XAF",
        isDefault: true
      }
    }));

  await prisma.feeRule.create({
    data: {
      organizationId: organization.id,
      name: "Default hybrid fee",
      type: FeeRuleType.HYBRID,
      flatAmount: "0",
      percentageRate: "0"
    }
  }).catch(() => undefined);

  const gatewayProviders = [
    GatewayProvider.CAMPAY,
    GatewayProvider.FAPSHI,
    GatewayProvider.MAVIANCE,
    GatewayProvider.CINETPAY,
    GatewayProvider.FLUTTERWAVE,
    GatewayProvider.MONETBIL
  ];

  for (const provider of gatewayProviders) {
    await prisma.organizationProviderAccess.upsert({
      where: {
        organizationId_provider: {
          organizationId: organization.id,
          provider
        }
      },
      update: {
        isEnabled: true
      },
      create: {
        organizationId: organization.id,
        provider,
        isEnabled: true
      }
    });

    await prisma.appProviderAccess.upsert({
      where: {
        appId_provider: {
          appId: app.id,
          provider
        }
      },
      update: {
        isEnabled: true
      },
      create: {
        appId: app.id,
        provider,
        isEnabled: true
      }
    });

    const sandboxBaseUrl =
      provider === GatewayProvider.CAMPAY
        ? "https://demo.campay.net"
        : provider === GatewayProvider.FAPSHI
          ? "https://live.fapshi.com"
        : provider === GatewayProvider.CINETPAY
          ? "https://api-checkout.cinetpay.com"
          : provider === GatewayProvider.MAVIANCE
            ? "https://api.maviance.com"
            : provider === GatewayProvider.FLUTTERWAVE
              ? "https://api.flutterwave.com"
              : "https://api.monetbil.com";

    const config = await prisma.gatewayConfig.upsert({
      where: { provider },
      update: {
        baseUrl: sandboxBaseUrl
      },
      create: {
        provider,
        displayName: provider,
        baseUrl: sandboxBaseUrl,
        encryptedPublicKey: `${provider}_PUBLIC_PLACEHOLDER`,
        encryptedSecretKey: `${provider}_SECRET_PLACEHOLDER`,
        metadata: {
          mode: "sandbox",
          routeStrategy: provider === GatewayProvider.CAMPAY ? "primary" : "failover",
          providerFeeFlatAmount: 0,
          providerFeePercentageRate: 0,
          capabilities: providerCapabilities(provider)
        }
      }
    });

    await prisma.gatewayHealth.upsert({
      where: { provider },
      update: {
        status: "healthy",
        latencyMs: 120,
        lastCheckedAt: new Date()
      },
      create: {
        provider,
        status: "healthy",
        latencyMs: 120,
        lastCheckedAt: new Date(),
        gatewayConfigId: config.id
      }
    });
  }

  const existingTransaction = await prisma.transaction.findFirst({
    where: { externalReference: "campus-fee-0001" }
  });

  if (existingTransaction) {
    return;
  }

  const transaction = await prisma.transaction.create({
    data: {
      appId: app.id,
      organizationId: organization.id,
      externalReference: "campus-fee-0001",
      idempotencyKey: "idem-campus-fee-0001",
      currency: "XAF",
      amount: "100000",
      grossAmount: "102500",
      gatewayFeeAmount: "1500",
      platformFeeAmount: "1000",
      netAmount: "100000",
      settlementAmount: "100000",
      selectedProvider: GatewayProvider.CAMPAY,
      customerName: "Demo Parent",
      customerEmail: "parent@example.com",
      customerPhone: "237670000001",
      metadata: {
        studentId: "STU-001",
        invoiceId: "INV-2026-001"
      }
    }
  });

  const gateway = await prisma.gatewayConfig.findUniqueOrThrow({
    where: { provider: GatewayProvider.CAMPAY }
  });

  await prisma.paymentAttempt.create({
    data: {
      transactionId: transaction.id,
      gatewayConfigId: gateway.id,
      status: "SUCCESS",
      gatewayReference: "CMP-TEST-001",
      requestPayload: { amount: 102500, currency: "XAF" },
      responsePayload: { status: "SUCCESS" },
      completedAt: new Date()
    }
  });

  await prisma.transactionEvent.create({
    data: {
      transactionId: transaction.id,
      eventType: "transaction.created",
      payload: { status: "PENDING" }
    }
  });

  await prisma.settlement.create({
    data: {
      transactionId: transaction.id,
      organizationId: organization.id,
      payoutDestinationId: payoutDestination.id,
      grossAmount: "102500",
      gatewayFeeAmount: "1500",
      platformFeeAmount: "1000",
      settlementAmount: "100000",
      destinationSnapshot: {
        type: payoutDestination.destinationType,
        ref: payoutDestination.destinationRef
      }
    }
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});
