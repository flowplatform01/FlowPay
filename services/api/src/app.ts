import "./utils/diagnosticsPolyfill.js";
import { Prisma } from "@prisma/client";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerSwagger } from "./config/swagger.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerAppRoutes } from "./modules/apps/apps.routes.js";
import { registerTransactionRoutes } from "./modules/transactions/transactions.routes.js";
import { registerWebhookRoutes } from "./modules/webhooks/webhooks.routes.js";
import { registerMonitoringRoutes } from "./modules/monitoring/monitoring.routes.js";
import { registerOrganizationRoutes } from "./modules/organizations/organizations.routes.js";
import { registerProviderRoutes } from "./modules/providers/providers.routes.js";
import { registerDestinationProfileRoutes } from "./modules/destination-profiles/destination-profiles.routes.js";
import { registerCreditRoutes } from "./modules/credits/credits.routes.js";
import { registerCapacityPolicyRoutes } from "./modules/capacity-policy/capacity-policy.routes.js";
import { registerFeeRoutes } from "./modules/fees/fee-rules.routes.js";
import { registerRevenuePayoutRoutes } from "./modules/revenue-payouts/revenue-payouts.routes.js";
import { registerTreasuryRoutes } from "./modules/treasury/treasury.routes.js";
import { registerPayoutRoutes } from "./modules/payouts/payouts.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P1000", "P1001", "P1002"].includes(error.code)) {
        request.log.error(error);
        return reply.code(503).send({
          statusCode: 503,
          code: error.code,
          error: "Service Unavailable",
          message: "Database is temporarily unavailable"
        });
      }

      if (error.code === "P2002") {
        return reply.code(409).send({
          statusCode: 409,
          code: error.code,
          error: "Conflict",
          message: "Duplicate resource"
        });
      }
    }

    return reply.send(error);
  });

  await registerSwagger(app);

  app.get("/", async () => ({
    service: "FlowPay API",
    status: "ok",
    health: "/api/v1/health",
    docs: "/docs"
  }));

  await app.register(async (instance) => {
    await registerHealthRoutes(instance);
    await registerAppRoutes(instance);
    await registerOrganizationRoutes(instance);
    await registerProviderRoutes(instance);
    await registerDestinationProfileRoutes(instance);
    await registerTransactionRoutes(instance);
    await registerWebhookRoutes(instance);
    await registerMonitoringRoutes(instance);
    await registerCreditRoutes(instance);
    await registerCapacityPolicyRoutes(instance);
    await registerFeeRoutes(instance);
    await registerPayoutRoutes(instance);
    await registerRevenuePayoutRoutes(instance);
    await registerTreasuryRoutes(instance);
  }, { prefix: "/api/v1" });

  return app;
}
