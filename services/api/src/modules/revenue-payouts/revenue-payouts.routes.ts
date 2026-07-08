import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayProvider } from "@prisma/client";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  createRevenuePayout,
  getRevenuePayoutBalance,
  listRevenuePayouts,
  processRevenuePayout
} from "./revenue-payouts.service.js";

const balanceQuerySchema = z.object({
  organizationId: z.string().min(1),
  currency: z.string().length(3).default("XAF")
});

const createRevenuePayoutSchema = z.object({
  organizationId: z.string().min(1),
  payoutDestinationId: z.string().min(1),
  provider: z.nativeEnum(GatewayProvider),
  amount: z.number().positive(),
  currency: z.string().length(3).default("XAF"),
  idempotencyKey: z.string().min(8),
  metadata: z.record(z.any()).optional()
});

export async function registerRevenuePayoutRoutes(app: FastifyInstance) {
  app.get("/internal/revenue-payouts", { preHandler: [verifyInternalService] }, async (request) => {
    const query = request.query as { organizationId?: string };
    return listRevenuePayouts(query.organizationId);
  });

  app.get("/internal/revenue-payouts/balance", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = balanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid revenue payout balance query" });
    }

    return getRevenuePayoutBalance(parsed.data);
  });

  app.post("/internal/revenue-payouts", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = createRevenuePayoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid revenue payout payload" });
    }

    try {
      return reply.code(201).send(await createRevenuePayout(parsed.data));
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to create revenue payout"
      });
    }
  });

  app.post("/internal/revenue-payouts/:id/process", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      return processRevenuePayout(id);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to process revenue payout"
      });
    }
  });
}
