import { PrismaClient } from "@prisma/client";

/**
 * Resilient Prisma client for managed/serverless PostgreSQL databases.
 *
 * Query retries are intentionally narrow: retry once for transient connection
 * failures, then surface the error. Startup uses bounded attempts with a per
 * attempt timeout so network stalls cannot block the process indefinitely.
 */

const RETRYABLE_ERRORS = [
  "Connection is closed",
  "Can't reach database server",
  "Connection refused",
  "Connection terminated unexpectedly",
  "socket hang up",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "timed out"
];

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_ERRORS.some((pattern) => message.includes(pattern));
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (!isRetryableError(error)) {
            throw error;
          }

          console.warn(`[DB] Stale connection detected on ${model}.${operation}; retrying once...`);

          try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return await query(args);
          } catch (retryError) {
            console.error("[DB] Retry failed:", retryError instanceof Error ? retryError.message : retryError);
            throw retryError;
          }
        }
      }
    }
  }
});

/** Managed/serverless DB benefits from longer interactive transactions than Prisma's 5s default. */
export const prismaTransactionOptions = {
  maxWait: 10_000,
  timeout: 30_000
} as const;

export async function connectWithRetry(maxRetries = 8, baseDelayMs = 2_000, attemptTimeoutMs = 10_000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await withTimeout(
        (async () => {
          await prisma.$connect();
          await prisma.$queryRaw`SELECT 1`;
        })(),
        attemptTimeoutMs,
        "Database startup connection"
      );
      console.log(`[DB] Connected to database (attempt ${attempt})`);
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const delay = Math.min(baseDelayMs * attempt, 30_000);
      const message = error instanceof Error ? error.message : String(error);

      await prisma.$disconnect().catch(() => undefined);

      if (isLastAttempt) {
        console.error(`[DB] Failed to connect after ${maxRetries} attempts. Last error: ${message}`);
        throw error;
      }

      console.warn(`[DB] Database not ready (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
