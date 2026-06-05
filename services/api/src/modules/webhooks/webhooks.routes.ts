import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { GatewayProvider, type Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { addQueueJobSafely, retryQueue } from "../../lib/queues.js";
import { getGatewayAdapter } from "../gateways/gateways.service.js";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { processGatewayWebhook } from "./gateway-webhook.service.js";

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post("/internal/webhooks/:id/replay", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const log = await prisma.webhookLog.findUniqueOrThrow({
      where: { id }
    });

    const retryJob = await prisma.retryJob.create({
      data: {
        transactionId: log.transactionId,
        queueName: "webhook-replay",
        reason: "Manual webhook replay requested from Flow Admin",
        status: "QUEUED",
        nextRunAt: new Date(),
        payload: {
          webhookLogId: log.id,
          provider: log.provider
        }
      }
    });

    if (retryQueue) {
      const queue = retryQueue;
      const queueResult = await addQueueJobSafely("retry-queue", () =>
        queue.add("replay-webhook", {
          webhookLogId: log.id,
          provider: log.provider,
          transactionId: log.transactionId
        })
      );

      if (!queueResult.enqueued) {
        await prisma.retryJob.update({
          where: { id: retryJob.id },
          data: {
            status: "FAILED",
            reason: `Manual webhook replay queue unavailable: ${queueResult.reason}`
          }
        });
      }
    }

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        errorMessage: "Replay requested from Flow Admin"
      }
    });

    await prisma.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "webhook.replay_requested",
        entityType: "WebhookLog",
        entityId: log.id,
        payload: {
          provider: log.provider,
          transactionId: log.transactionId,
          retryJobId: retryJob.id
        }
      }
    });

    return reply.send({
      webhookLogId: log.id,
      retryJob
    });
  });

  app.post("/webhooks/:provider", async (request, reply) => {
    const { provider } = request.params as { provider: GatewayProvider };
    if (!Object.values(GatewayProvider).includes(provider)) {
      return reply.code(400).send({ message: "Unsupported provider" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const payloadString = JSON.stringify(body);
    const signature =
      request.headers["x-flowpay-signature"]?.toString() ??
      request.headers["x-campay-signature"]?.toString() ??
      request.headers["x-signature"]?.toString();
    const requestId = resolveWebhookRequestId({
      headers: request.headers,
      body,
      payloadString,
      signature,
      provider
    });

    if (requestId) {
      const existing = await prisma.webhookLog.findFirst({
        where: {
          provider,
          requestId
        },
        orderBy: { createdAt: "desc" }
      });

      if (existing) {
        const payload = {
          received: true,
          webhookLogId: existing.id,
          processed: existing.processed,
          deduplicated: true,
          transactionId: existing.transactionId
        };

        if (existing.statusCode && existing.statusCode >= 400) {
          return reply.code(existing.statusCode).send({
            ...payload,
            received: false,
            message: existing.errorMessage ?? "Previously rejected webhook"
          });
        }

        return reply.send(payload);
      }
    }

    const adapter = getGatewayAdapter(provider);
    const valid = adapter.verifyWebhookSignature(payloadString, signature);

    const log = await prisma.webhookLog.create({
      data: {
        provider,
        requestId,
        signature,
        payload: body as Prisma.InputJsonValue,
        processed: false,
        statusCode: valid ? 200 : 401,
        errorMessage: valid ? null : "Invalid webhook signature"
      }
    });

    if (!valid) {
      return reply.code(401).send({ message: "Invalid webhook signature", webhookLogId: log.id });
    }

    const result = await processGatewayWebhook(provider, body);

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        processed: result.processed,
        transactionId: result.transactionId,
        errorMessage: result.processed ? null : result.reason
      }
    });

    return reply.send({ received: true, webhookLogId: log.id, ...result });
  });
}

function resolveWebhookRequestId(input: {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  payloadString: string;
  signature?: string;
  provider: GatewayProvider;
}) {
  const headerRequestId =
    input.headers["x-flowpay-event-id"]?.toString() ??
    input.headers["x-campay-reference"]?.toString() ??
    input.headers["x-request-id"]?.toString();

  if (headerRequestId) {
    return headerRequestId;
  }

  const reference = firstString([
    input.body.reference,
    input.body.transaction_id,
    input.body.transactionId,
    input.body.payment_token,
    input.body.cpm_reference,
    input.body.external_reference,
    input.body.externalReference,
    input.body.order_id
  ]);
  const status = firstString([
    input.body.status,
    input.body.payment_status,
    input.body.transaction_status,
    input.body.event
  ]);
  const payloadHash = hashWebhookPart(input.payloadString);
  const replayBase = JSON.stringify({
    provider: input.provider,
    reference: reference ?? null,
    status: status ?? null,
    signature: input.signature ?? null,
    payloadHash
  });

  return `synthetic:${hashWebhookPart(replayBase)}`;
}

function firstString(values: unknown[]) {
  const value = values.find((item) => typeof item === "string" && item.length > 0);
  return value?.toString();
}

function hashWebhookPart(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
