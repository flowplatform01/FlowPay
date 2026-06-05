import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const feeRules = await prisma.feeRule.updateMany({
    data: {
      flatAmount: "0",
      percentageRate: "0",
      isActive: true
    }
  });

  const gateways = await prisma.gatewayConfig.findMany();
  let gatewayUpdates = 0;

  for (const gateway of gateways) {
    const metadata =
      gateway.metadata && typeof gateway.metadata === "object" && !Array.isArray(gateway.metadata)
        ? { ...(gateway.metadata as Record<string, unknown>) }
        : {};

    metadata.providerFeeFlatAmount = 0;
    metadata.providerFeePercentageRate = 0;

    await prisma.gatewayConfig.update({
      where: { id: gateway.id },
      data: { metadata }
    });
    gatewayUpdates += 1;
  }

  console.log(`Updated ${feeRules.count} fee rule(s) to zero.`);
  console.log(`Updated ${gatewayUpdates} gateway config(s) to zero provider fees.`);
  console.log("New payments will charge exactly the base amount (e.g. 2 XAF → 2 XAF total).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
