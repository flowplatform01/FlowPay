import type { FastifyInstance } from "fastify";
import { GatewayProvider } from "@prisma/client";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  approveTreasuryWithdrawal,
  cancelTreasuryWithdrawal,
  createTreasuryWithdrawal,
  executeTreasuryWithdrawal,
  getTreasuryOverview,
  reconcileTreasuryLedger
} from "./treasury.service.js";

export async function registerTreasuryRoutes(app: FastifyInstance) {
  app.get("/internal/treasury", { preHandler: [verifyInternalService] }, async () =>
    getTreasuryOverview()
  );

  app.post("/internal/treasury/reconcile", { preHandler: [verifyInternalService] }, async (request) => {
    const body = (request.body ?? {}) as { limit?: number };
    return reconcileTreasuryLedger({ limit: body.limit });
  });

  app.post("/internal/treasury/withdrawals", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      amount?: number;
      currency?: string;
      provider?: GatewayProvider;
      destinationType?: string;
      destinationRef?: string;
      requestedBy?: string | null;
      reason?: string | null;
      metadata?: Record<string, unknown>;
    };

    if (!body.amount || !body.currency || !body.provider || !body.destinationType || !body.destinationRef) {
      return reply.code(400).send({
        code: "TREASURY_WITHDRAWAL_INVALID_REQUEST",
        message: "amount, currency, provider, destinationType, and destinationRef are required"
      });
    }

    if (!isGatewayProvider(body.provider)) {
      return reply.code(400).send({
        code: "TREASURY_WITHDRAWAL_INVALID_PROVIDER",
        message: "Treasury withdrawal provider is not supported"
      });
    }

    return reply.code(201).send(
      await createTreasuryWithdrawal({
        amount: body.amount,
        currency: body.currency,
        provider: body.provider,
        destinationType: body.destinationType,
        destinationRef: body.destinationRef,
        requestedBy: body.requestedBy,
        reason: body.reason,
        metadata: body.metadata
      })
    );
  });

  app.post("/internal/treasury/withdrawals/:id/approve", { preHandler: [verifyInternalService] }, async (request) => {
    const body = (request.body ?? {}) as { actorId?: string | null };
    return approveTreasuryWithdrawal(paramValue((request.params as { id?: string }).id), body.actorId);
  });

  app.post("/internal/treasury/withdrawals/:id/cancel", { preHandler: [verifyInternalService] }, async (request) => {
    const body = (request.body ?? {}) as { actorId?: string | null; reason?: string | null };
    return cancelTreasuryWithdrawal(paramValue((request.params as { id?: string }).id), body.actorId, body.reason);
  });

  app.post("/internal/treasury/withdrawals/:id/execute", { preHandler: [verifyInternalService] }, async (request) => {
    const body = (request.body ?? {}) as { actorId?: string | null };
    return executeTreasuryWithdrawal(paramValue((request.params as { id?: string }).id), body.actorId);
  });
}

function isGatewayProvider(value: string): value is GatewayProvider {
  return Object.values(GatewayProvider).includes(value as GatewayProvider);
}

function paramValue(value: string | undefined) {
  if (!value) {
    throw new Error("Missing route parameter");
  }

  return value;
}
