import type { FastifyInstance } from "fastify";
import {
  createAppSchema,
  rotateAppCredentialsSchema,
  topUpAppCreditsSchema,
  updateAppAccessSchema,
  updateAppSchema
} from "./apps.schema.js";
import {
  createAppRegistration,
  listApps,
  rotateAppCredentials,
  topUpAppCredits,
  updateAppAccess,
  updateAppConfiguration
} from "./apps.service.js";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { initiateCreditPurchase } from "../credits/credits.service.js";
import { createTransaction } from "../transactions/transactions.service.js";
import { buildHostedCheckoutUrl, readTransactionMetadata } from "../checkout/checkout.service.js";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { resolveProviderFromPaymentMethod } from "../payments/payment-channels.js";
import { randomUUID } from "crypto";

export async function registerAppRoutes(app: FastifyInstance) {
  app.get("/internal/apps", { preHandler: [verifyInternalService] }, async () => listApps());

  app.post("/internal/apps", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = createAppSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid app registration payload" });
    }

    const result = await createAppRegistration(parsed.data);
    return reply.code(201).send(result);
  });

  app.patch("/internal/apps/:id", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateAppSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid app update payload" });
    }

    const { id } = request.params as { id: string };
    const result = await updateAppConfiguration(id, parsed.data);
    return reply.send(result);
  });

  app.post("/internal/apps/:id/topup", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = topUpAppCreditsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid app credit top-up payload" });
    }

    const { id } = request.params as { id: string };
    const result = await topUpAppCredits(id, parsed.data);
    return reply.send(result);
  });

  app.post("/internal/apps/:id/purchase-credits", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = z.object({ amountXaf: z.number().positive() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid purchase payload" });
    }

    const { id } = request.params as { id: string };
    const { amountXaf } = parsed.data;

    // Resolve app + org to satisfy createTransaction's required fields
    const appRecord = await prisma.app.findUniqueOrThrow({
      where: { id },
      include: {
        organization: true,
        providerAccesses: true,
        capabilities: true
      }
    });

    const purchase = await initiateCreditPurchase(id, { amountXaf });

    const defaultProvider = resolveProviderFromPaymentMethod("MTN_MOMO");

    const transaction = await createTransaction({
      appId: id,
      organizationId: appRecord.organizationId,
      idempotencyKey: randomUUID(),
      externalReference: purchase.externalReference,
      amount: amountXaf,
      currency: "XAF",
      provider: defaultProvider,
      deferCapture: true,
      customerName: "FlowPay App Administrator",
      metadata: purchase.instructions.metadata as Record<string, unknown>,
      appProfile: appRecord
    });

    const txMetadata = readTransactionMetadata(transaction.metadata);
    const sessionToken = txMetadata.checkoutSessionToken ?? "";
    const checkoutUrl = buildHostedCheckoutUrl(transaction.id, sessionToken);

    return reply.code(201).send({
      purchaseIntentId: purchase.purchaseIntentId,
      checkoutUrl
    });
  });

  app.put("/internal/apps/:id/access", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateAppAccessSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid app access payload" });
    }

    const { id } = request.params as { id: string };
    const result = await updateAppAccess(id, parsed.data);
    return reply.send(result);
  });

  app.post("/internal/apps/:id/rotate-credentials", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = rotateAppCredentialsSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid credential rotation payload" });
    }

    const { id } = request.params as { id: string };
    const result = await rotateAppCredentials(id, parsed.data);
    return reply.send(result);
  });
}
