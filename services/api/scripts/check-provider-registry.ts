import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const providers = await prisma.gatewayConfig.findMany({
    select: {
      provider: true,
      isEnabled: true,
      baseUrl: true,
      metadata: true,
      health: {
        select: {
          status: true,
          errorMessage: true
        }
      }
    },
    orderBy: { provider: "asc" }
  });

  const migrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
    "select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 5"
  );

  console.log(
    JSON.stringify(
      {
        providers: providers.map((provider) => ({
          provider: provider.provider,
          isEnabled: provider.isEnabled,
          baseUrl: provider.baseUrl,
          mode:
            provider.metadata && typeof provider.metadata === "object" && !Array.isArray(provider.metadata)
              ? (provider.metadata as Record<string, unknown>).mode ?? null
              : null,
          health: provider.health?.status ?? null,
          healthNote: provider.health?.errorMessage ?? null
        })),
        recentMigrations: migrations.map((migration) => ({
          migration: migration.migration_name,
          finishedAt: migration.finished_at
        }))
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
