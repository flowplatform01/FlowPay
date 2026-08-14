import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const requiredTables = [
  "AppProviderAccess",
  "AppCapabilityGrant",
  "OrganizationProviderAccess",
  "GatewayConfig",
  "Organization",
  "App"
] as const;

try {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${PrismaJoin(requiredTables)})
    ORDER BY table_name
  `;

  const existing = new Set(tables.map((table) => table.table_name));
  const missing = requiredTables.filter((table) => !existing.has(table));

  console.log(
    JSON.stringify(
      {
        ok: missing.length === 0,
        existing: [...existing].sort(),
        missing
      },
      null,
      2
    )
  );

  process.exitCode = missing.length === 0 ? 0 : 1;
} finally {
  await prisma.$disconnect();
}

function PrismaJoin(values: readonly string[]) {
  return Prisma.join(values);
}
