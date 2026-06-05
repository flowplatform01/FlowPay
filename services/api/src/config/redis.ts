import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env.js";

let redisClient: Redis | null = null;
const redisLogState = new Map<string, number>();
let redisCircuitOpenUntil = 0;

const REDIS_CIRCUIT_OPEN_MS = 15 * 60_000;

function redisRetryDelay(attempt: number) {
  return Math.min(1_000 * 2 ** Math.max(attempt - 1, 0), 60_000);
}

function warnRedisThrottled(label: string, message: string) {
  const key = `${label}:${message}`;
  const now = Date.now();
  const last = redisLogState.get(key) ?? 0;
  if (now - last < 60_000) return;
  redisLogState.set(key, now);
  console.warn(message);
}

export function isRedisCircuitOpen() {
  return Date.now() < redisCircuitOpenUntil;
}

export function isRedisQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("max requests limit exceeded");
}

export function openRedisCircuit(label: string, error: unknown) {
  redisCircuitOpenUntil = Math.max(redisCircuitOpenUntil, Date.now() + REDIS_CIRCUIT_OPEN_MS);
  const message = error instanceof Error ? error.message : String(error);
  warnRedisThrottled(
    `circuit:${label}`,
    `[Redis:${label}] Request quota exhausted; Redis-dependent queues/cache disabled for ${REDIS_CIRCUIT_OPEN_MS / 60_000} minutes. ${message}`
  );
}

function getRedisConnectionConfig(mode: "health" | "queue" | "startup" = "health"): RedisOptions {
  if (!env.REDIS_URL) {
    return {};
  }

  const redisUrl = new URL(env.REDIS_URL);
  const shouldUseTls =
    redisUrl.protocol === "rediss:" ||
    redisUrl.hostname.toLowerCase().includes("upstash.io");

  return {
    lazyConnect: mode === "startup",
    enableOfflineQueue: mode !== "startup",
    enableReadyCheck: false,
    retryStrategy:
      mode === "startup"
        ? () => null
        : (attempt) => (isRedisCircuitOpen() ? null : redisRetryDelay(attempt)),
    reconnectOnError: () => false,
    maxRetriesPerRequest: null,
    connectTimeout: 15_000,
    keepAlive: 10_000,
    ...(shouldUseTls ? { tls: { servername: redisUrl.hostname } } : {})
  };
}

export function createRedisConnection(label = "redis"): Redis | null {
  if (!env.REDIS_URL) return null;
  if (isRedisCircuitOpen()) {
    warnRedisThrottled(`skip:${label}`, `[Redis:${label}] Skipped because Redis circuit is open`);
    return null;
  }
  if (!redisClient && env.NODE_ENV !== "production") {
    console.log(`[Redis:${label}] Skipped because Redis startup probe is unavailable`);
    return null;
  }

  const client = new Redis(env.REDIS_URL, getRedisConnectionConfig("queue"));
  client.on("error", (err) => {
    if (isRedisQuotaError(err)) {
      openRedisCircuit(label, err);
      client.disconnect(false);
      return;
    }
    warnRedisThrottled(`error:${label}`, `[Redis:${label}] Error: ${err.message}`);
  });
  client.on("close", () => {
    warnRedisThrottled(`close:${label}`, `[Redis:${label}] Connection closed; reconnecting with backoff`);
  });

  return client;
}

async function initRedis(): Promise<Redis | null> {
  if (!env.REDIS_URL) {
    console.log("[Redis] No REDIS_URL configured - cache disabled");
    return null;
  }

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const client = new Redis(env.REDIS_URL, getRedisConnectionConfig("startup"));

    client.on("error", () => {
      // Errors are handled by the startup catch below.
    });

    try {
      await client.connect();
      await client.ping();
      console.log(`[Redis] Connected and ready (attempt ${attempt})`);
      client.disconnect();

      const longLivedClient = new Redis(env.REDIS_URL, getRedisConnectionConfig("health"));
      longLivedClient.on("error", (err) => {
        if (isRedisQuotaError(err)) {
          openRedisCircuit("health", err);
          longLivedClient.disconnect(false);
          return;
        }
        warnRedisThrottled("error:health", `[Redis] Error: ${err.message}`);
      });
      longLivedClient.on("close", () => {
        warnRedisThrottled("close:health", "[Redis] Connection closed; reconnecting with backoff");
      });

      return longLivedClient;
    } catch (error) {
      if (isRedisQuotaError(error)) {
        openRedisCircuit("startup", error);
        client.disconnect();
        if (env.NODE_ENV !== "production") {
          console.log("[Redis] Request quota exhausted - running in cache-disabled fallback mode");
          return null;
        }

        throw error;
      }
      client.disconnect();
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }

  if (env.NODE_ENV !== "production") {
    console.log("[Redis] Unavailable - running in cache-disabled fallback mode");
    return null;
  }

  throw new Error("[Redis] Connection failed. Redis is required in production");
}

redisClient = await initRedis();

export const redis = redisClient;

export async function isRedisAvailable(): Promise<boolean> {
  if (isRedisCircuitOpen()) return false;
  if (!redis) return false;
  try {
    await redis.ping();
    return true;
  } catch (error) {
    if (isRedisQuotaError(error)) {
      openRedisCircuit("health", error);
    }
    return false;
  }
}
