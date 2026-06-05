import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();
const prisma = new PrismaClient();

const rules = await prisma.feeRule.findMany({
  include: { organization: { select: { name: true, slug: true } } },
  orderBy: { createdAt: "desc" }
});

for (const rule of rules) {
  console.log(
    `${rule.organization.name} (${rule.organization.slug}) | active=${rule.isActive} | flat=${rule.flatAmount} | rate=${rule.percentageRate}%`
  );
}

await prisma.$disconnect();
