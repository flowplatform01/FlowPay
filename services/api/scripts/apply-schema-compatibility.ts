import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationName = "20260814123000_access_control_tables";
const migrationPath = join("prisma", "migrations", migrationName, "migration.sql");

try {
  const alreadyApplied = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
        AND finished_at IS NOT NULL
    ) AS exists
  `;

  if (alreadyApplied[0]?.exists) {
    console.log(JSON.stringify({ ok: true, skipped: true, migrationName }, null, 2));
    process.exit(0);
  }

  const sql = await readFile(migrationPath, "utf8");
  for (const statement of splitSqlStatements(sql)) {
    await prisma.$executeRawUnsafe(statement);
  }

  await prisma.$executeRaw`
    INSERT INTO "_prisma_migrations" (
      id,
      checksum,
      finished_at,
      migration_name,
      logs,
      rolled_back_at,
      started_at,
      applied_steps_count
    )
    VALUES (
      ${randomUUID()},
      ${"manual-compatibility-apply"},
      NOW(),
      ${migrationName},
      ${"Applied via scripts/apply-schema-compatibility.ts because prisma migrate deploy failed in schema engine."},
      NULL,
      NOW(),
      1
    )
  `;

  console.log(JSON.stringify({ ok: true, skipped: false, migrationName }, null, 2));
} finally {
  await prisma.$disconnect();
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextTwo = sql.slice(index, index + 2);

    if (!inSingleQuote && !dollarQuoteTag && nextTwo === "--") {
      const newline = sql.indexOf("\n", index);
      if (newline === -1) break;
      index = newline;
      continue;
    }

    if (!inSingleQuote && char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (dollarQuoteTag === tag) {
          dollarQuoteTag = null;
        } else if (!dollarQuoteTag) {
          dollarQuoteTag = tag;
        }
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }

    if (!dollarQuoteTag && char === "'" && sql[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
    }

    if (!inSingleQuote && !dollarQuoteTag && char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}
