import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getCreditBalance,
  getCreditHistory,
  initiateCreditPurchase,
  listCreditPurchases
} from "./credits.service.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";

const getCreditHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const initiatePurchaseSchema = z.object({
  amountXaf: z.number().positive(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional()
});

export async function registerCreditRoutes(app: FastifyInstance) {
  app.get(
    "/credits/balance",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const balance = await getCreditBalance(request.appAuth.appId);
      return reply.send(balance);
    }
  );

  app.get(
    "/credits/history",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const parsed = getCreditHistorySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid query parameters" });
      }

      const history = await getCreditHistory(request.appAuth.appId, parsed.data);
      return reply.send(history);
    }
  );

  app.post(
    "/credits/purchase/initiate",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const parsed = initiatePurchaseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid purchase payload" });
      }

      const purchase = await initiateCreditPurchase(
        request.appAuth.appId,
        parsed.data
      );

      return reply.code(201).send(purchase);
    }
  );

  app.get(
    "/credits/purchases",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const purchases = await listCreditPurchases(request.appAuth.appId);
      return reply.send({ purchases });
    }
  );
}
