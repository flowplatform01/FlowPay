import type { FastifyInstance } from "fastify";
import { GatewayProvider } from "@prisma/client";
import { z } from "zod";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";
import { createAppRevenuePayout } from "../revenue-payouts/revenue-payouts.service.js";

const createPayoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default("XAF"),
  reference: z.string().min(3).max(120),
  destinationProfileId: z.string().min(1).optional(),
  externalRecipientId: z.string().min(1).optional(),
  provider: z.nativeEnum(GatewayProvider).optional(),
  metadata: z.record(z.unknown()).optional()
});

export async function registerPayoutRoutes(app: FastifyInstance) {
  app.post("/payouts", { preHandler: [verifyAppSecretKey] }, async (request, reply) => {
    const parsed = createPayoutSchema.safeParse(request.body);

    if (!parsed.success || !request.appAuth?.appProfile) {
      return reply.code(400).send({ message: "Invalid payout payload" });
    }

    const idempotencyKey = request.headers["idempotency-key"]?.toString() ?? parsed.data.reference;

    try {
      const payout = await createAppRevenuePayout({
        appId: request.appAuth.appId,
        organizationId: request.appAuth.organizationId,
        appProfile: request.appAuth.appProfile,
        idempotencyKey,
        ...parsed.data
      });

      return reply.code(payout.created ? 201 : 200).send(payout.response);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to create payout"
      });
    }
  });
}
