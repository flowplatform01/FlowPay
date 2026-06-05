import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient, FeeRuleType, GatewayProvider } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function generateKey(prefix: string, length: number = 32) {
  return `${prefix}_${crypto.randomBytes(length).toString('hex')}`;
}

async function main() {
  console.log("Creating new test organization...");
  const organization = await prisma.organization.create({
    data: {
      name: "New Test Org",
      slug: `test-org-${Date.now()}`,
      countryCode: "CM",
      settlementCurrency: "XAF"
    }
  });

  const clientId = generateKey("client", 8);
  const clientSecret = generateKey("secret", 16);
  const publicKey = generateKey("fpub", 16);
  const secretKey = generateKey("fsec", 16);
  const webhookSecret = generateKey("fwhsec", 16);

  console.log("Creating newtest app...");
  const app = await prisma.app.create({
    data: {
      name: "newtest",
      slug: `newtest-${Date.now()}`,
      organizationId: organization.id,
      clientId: clientId,
      clientSecretHash: hashSecret(clientSecret),
      appPublicKey: publicKey,
      webhookUrl: "http://127.0.0.1:3025/webhooks/flowpay"
    }
  });

  console.log("Generating API Keys...");
  await prisma.apiKey.createMany({
    data: [
      { appId: app.id, type: "PUBLIC", label: "Public key", hashedKey: hashSecret(publicKey) },
      { appId: app.id, type: "SECRET", label: "Secret key", hashedKey: hashSecret(secretKey) },
      { appId: app.id, type: "WEBHOOK", label: "Webhook secret", hashedKey: hashSecret(webhookSecret) }
    ]
  });

  console.log("Granting capabilities...");
  for (const capability of ["PAYIN", "WEBHOOKS", "REFUNDS", "MANUAL_REVIEW"]) {
    await prisma.appCapabilityGrant.create({
      data: {
        appId: app.id,
        capability,
        isEnabled: true
      }
    });
  }

  console.log("Configuring Provider Access...");
  for (const provider of [GatewayProvider.CAMPAY, GatewayProvider.MAVIANCE, GatewayProvider.CINETPAY]) {
    await prisma.organizationProviderAccess.create({
      data: {
        organizationId: organization.id,
        provider,
        isEnabled: true
      }
    });

    await prisma.appProviderAccess.create({
      data: {
        appId: app.id,
        provider,
        isEnabled: true
      }
    });
  }

  console.log("Updating external app .env.local...");
  const envPath = "C:\\Flow.Ltd\\flowpay-external-test-app\\.env.local";
  const envContent = `FLOWPAY_BASE_URL=http://localhost:3011
FLOWPAY_CLIENT_ID=${clientId}
FLOWPAY_PUBLIC_KEY=${publicKey}
FLOWPAY_SECRET_KEY=${secretKey}
FLOWPAY_WEBHOOK_SECRET=${webhookSecret}
TEST_APP_PORT=3025
`;

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log("✅ .env.local updated successfully at", envPath);
  console.log("✅ Onboarding complete! newtest is ready.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
