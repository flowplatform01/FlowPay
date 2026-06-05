import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { isRedisAvailable } from "../../config/redis.js";
import { getActiveAdapterMode } from "../gateways/gateways.service.js";
import { GATEWAY_PROVIDERS } from "../providers/provider-registry.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const [dbResult, redisResult] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      isRedisAvailable()
    ]);

    return {
      status:
        dbResult.status === "fulfilled" &&
        redisResult.status === "fulfilled" &&
        redisResult.value
          ? "ok"
          : "degraded",
      database: dbResult.status === "fulfilled" ? "ok" : "error",
      redis:
        redisResult.status === "fulfilled"
          ? redisResult.value
            ? "ok"
            : "degraded"
          : "error",
      gateways: Object.fromEntries(GATEWAY_PROVIDERS.map((provider) => [provider, getActiveAdapterMode(provider)])),
      campayWebhookUrl: env.gatewayWebhookUrl("CAMPAY")
    };
  });
}
