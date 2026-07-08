import type { FastifyInstance } from "fastify";
import { GatewayProvider } from "@prisma/client";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { updateProviderConfigSchema } from "./providers.schema.js";
import {
  listProviderCapabilities,
  listProviderConfigs,
  readProviderBalance,
  updateProviderConfig
} from "./providers.service.js";

export async function registerProviderRoutes(app: FastifyInstance) {
  app.get("/internal/providers", { preHandler: [verifyInternalService] }, async () => listProviderConfigs());
  app.get("/internal/providers/capabilities", { preHandler: [verifyInternalService] }, async () =>
    listProviderCapabilities()
  );
  app.get("/internal/providers/:provider/balance", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { provider } = request.params as { provider: GatewayProvider };
    if (!Object.values(GatewayProvider).includes(provider)) {
      return reply.code(400).send({ message: "Unsupported provider" });
    }

    try {
      return reply.send(await readProviderBalance(provider));
    } catch (error) {
      request.log.error({ error, provider }, "Provider balance lookup failed");
      return reply.code(502).send({ message: "Provider balance lookup failed" });
    }
  });

  app.patch("/internal/providers/:provider", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateProviderConfigSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid provider update payload" });
    }

    const { provider } = request.params as { provider: GatewayProvider };
    if (!Object.values(GatewayProvider).includes(provider)) {
      return reply.code(400).send({ message: "Unsupported provider" });
    }

    return reply.send(await updateProviderConfig(provider, parsed.data));
  });
}
