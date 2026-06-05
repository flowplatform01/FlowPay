import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({
    include: {
      feeRules: true,
      apps: { select: { id: true, name: true, clientId: true } }
    }
  });

  for (const org of orgs) {
    console.log(`\n${org.name} (${org.slug})`);
    for (const app of org.apps) {
      console.log(`  app: ${app.name} clientId=${app.clientId}`);
    }
    for (const rule of org.feeRules) {
      console.log(`  fee: active=${rule.isActive} flat=${rule.flatAmount} rate=${rule.percentageRate}`);
    }
  }

  const latest = await prisma.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      amount: true,
      grossAmount: true,
      platformFeeAmount: true,
      gatewayFeeAmount: true,
      organization: { select: { name: true } }
    }
  });

  console.log("\nLatest transactions:");
  for (const tx of latest) {
    console.log(
      `  ${tx.organization.name} | base=${tx.amount} platform=${tx.platformFeeAmount} gateway=${tx.gatewayFeeAmount} gross=${tx.grossAmount}`
    );
  }
}

main()
  .finally(() => prisma.$disconnect());
