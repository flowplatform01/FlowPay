import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { createTransactionSchema } from "./transactions.schema.js";
import {
  createTransaction,
  enqueueTransactionRetry,
  expireStalePendingCheckoutTransactions,
  getDashboardSummary,
  getTransactionById,
  listTransactions,
  markTransactionUnderReview
} from "./transactions.service.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { resolveOperationalProviderFromPaymentMethod } from "../payments/payment-channels.js";
import { confirmCheckoutSchema, checkoutSessionQuerySchema } from "../checkout/checkout.schema.js";
import {
  buildHostedCheckoutUrl,
  confirmHostedCheckout,
  readTransactionMetadata,
  refreshCheckoutSessionState,
  serializeCheckoutSession,
  enrichCheckoutSession,
  verifyCheckoutSessionToken
} from "../checkout/checkout.service.js";
import type { PaymentMethodId } from "../payments/payment-channels.js";
import { reconcileTransaction } from "./reconciliation.service.js";
import { FeeRangeMatchError } from "../fees/fee-rule.resolver.js";

export async function registerTransactionRoutes(app: FastifyInstance) {
  app.get("/internal/transactions", { preHandler: [verifyInternalService] }, async () =>
    listTransactions()
  );

  app.get("/internal/transactions/:id", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const transaction = await getTransactionById(id);

    if (!transaction) {
      return reply.code(404).send({ message: "Transaction not found" });
    }

    return transaction;
  });

  app.get("/internal/dashboard/summary", { preHandler: [verifyInternalService] }, async () =>
    getDashboardSummary()
  );

  app.post("/internal/transactions/:id/review", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { note?: string };
    return reply.send(await markTransactionUnderReview(id, body.note));
  });

  app.post("/internal/transactions/stale-pending/expire", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      olderThanMinutes?: number;
      limit?: number;
      dryRun?: boolean;
      reason?: string;
    };

    return reply.send(await expireStalePendingCheckoutTransactions(body));
  });

  app.post("/internal/transactions/:id/retry", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: string };
    const retry = await enqueueTransactionRetry(id, body.reason);
    let immediateReconciliation:
      | Awaited<ReturnType<typeof reconcileTransaction>>
      | { reconciled: false; error: string };

    try {
      immediateReconciliation = await reconcileTransaction({
        transactionId: id,
        reason: body.reason ?? "Manual retry requested from internal endpoint",
        attempt: 1,
        forceReviewRecheck: true
      });
    } catch (error) {
      immediateReconciliation = {
        reconciled: false,
        error: error instanceof Error ? error.message : "Immediate reconciliation failed"
      };
    }

    return reply.send({
      ...retry,
      immediateReconciliation
    });
  });

  app.post("/payments/initialize", { preHandler: [verifyAppSecretKey] }, async (request, reply) => {
    const parsed = createTransactionSchema.safeParse(request.body);

    if (!parsed.success || !request.appAuth) {
      return reply.code(400).send({ message: "Invalid payment initialization payload" });
    }

    const idempotencyKey = request.headers["idempotency-key"]?.toString();

    if (!idempotencyKey) {
      return reply.code(400).send({ message: "Idempotency-Key header is required" });
    }

    try {
      const provider =
        parsed.data.provider ??
        await resolveOperationalProviderFromPaymentMethod(parsed.data.paymentMethod as string, {
          appProviderAccesses: request.appAuth.appProfile?.providerAccesses
        });

      const transaction = await createTransaction({
        appId: request.appAuth.appId,
        organizationId: request.appAuth.organizationId,
        idempotencyKey,
        externalReference: parsed.data.externalReference,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        provider,
        paymentMethod: parsed.data.paymentMethod,
        externalRecipientId: parsed.data.externalRecipientId,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        customerPhone: parsed.data.customerPhone,
        metadata: parsed.data.metadata,
        ipAddress: request.ip,
        deferCapture: parsed.data.deferCapture,
        appProfile: request.appAuth.appProfile
      });

      const metadata = readTransactionMetadata(transaction.metadata);
      const checkoutSessionToken = metadata.checkoutSessionToken;

      return reply.code(201).send({
        ...transaction,
        checkout: checkoutSessionToken
          ? {
              sessionToken: checkoutSessionToken,
              url: buildHostedCheckoutUrl(transaction.id, checkoutSessionToken)
            }
          : null
      });
    } catch (error) {
      if (error instanceof FeeRangeMatchError) {
        return reply.code(422).send({
          message: error.message
        });
      }

      if (isTemporaryDatabaseError(error)) {
        return reply.code(503).send({
          statusCode: 503,
          code: error.code,
          error: "Service Unavailable",
          message: "Database is temporarily unavailable"
        });
      }

      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to initialize payment"
      });
    }
  });

  app.get("/checkout/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = checkoutSessionQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(401).send({ message: "Checkout session token is required" });
    }

    const transaction = await getTransactionById(id);

    if (!transaction) {
      return reply.code(404).send({ message: "Transaction not found" });
    }

    if (!verifyCheckoutSessionToken(transaction.metadata, query.data.token)) {
      return reply.code(401).send({ message: "Invalid checkout session token" });
    }

    const refreshedTransaction = await refreshCheckoutSessionState(transaction);

    return enrichCheckoutSession(refreshedTransaction);
  });

  app.get("/checkout/session/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = checkoutSessionQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(401).send({ message: "Checkout session token is required" });
    }

    const transaction = await getTransactionById(id);

    if (!transaction) {
      return reply.code(404).send({ message: "Transaction not found" });
    }

    if (!verifyCheckoutSessionToken(transaction.metadata, query.data.token)) {
      return reply.code(401).send({ message: "Invalid checkout session token" });
    }

    reply.hijack();
    const requestOrigin = request.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...(requestOrigin
        ? {
            "Access-Control-Allow-Origin": requestOrigin,
            Vary: "Origin"
          }
        : {})
    });
    reply.raw.write(": connected\n\n");

    let closed = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let maxLifetimeTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (maxLifetimeTimer) clearTimeout(maxLifetimeTimer);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    request.raw.on("close", cleanup);

    const sendStatus = async () => {
      if (closed) return;

      try {
        const latestTransaction = await getTransactionById(id);

        if (!latestTransaction || !verifyCheckoutSessionToken(latestTransaction.metadata, query.data.token)) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: "Checkout session unavailable" })}\n\n`);
          cleanup();
          return;
        }

        const refreshedTransaction = await refreshCheckoutSessionState(latestTransaction);
        const payload = await enrichCheckoutSession(refreshedTransaction);

        reply.raw.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);

        if (isCheckoutTerminalStatus(payload.status)) {
          cleanup();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Checkout status stream failed";
        reply.raw.write(`event: transient-error\ndata: ${JSON.stringify({ message })}\n\n`);
      }
    };

    heartbeatTimer = setInterval(() => {
      if (!closed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15_000);

    pollTimer = setInterval(() => {
      void sendStatus();
    }, 2_000);

    maxLifetimeTimer = setTimeout(cleanup, 5 * 60_000);

    void sendStatus();
  });

  app.post("/checkout/session/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = checkoutSessionQuerySchema.safeParse(request.query);
    const body = confirmCheckoutSchema.safeParse(request.body);

    if (!query.success) {
      return reply.code(401).send({ message: "Checkout session token is required" });
    }

    if (!body.success) {
      return reply.code(400).send({ message: "Invalid checkout confirmation payload" });
    }

    try {
      const transaction = await confirmHostedCheckout({
        transactionId: id,
        sessionToken: query.data.token,
        paymentMethod: body.data.paymentMethod as PaymentMethodId
      });

      return reply.send({
        ...(await enrichCheckoutSession(transaction)),
        message:
          transaction.status === "SUCCEEDED"
            ? "Payment completed successfully"
            : transaction.status === "FAILED"
              ? "Payment failed"
              : "Payment is still processing"
      });
    } catch (error) {
      if (isTemporaryDatabaseError(error)) {
        return reply.code(503).send({
          statusCode: 503,
          code: error.code,
          error: "Service Unavailable",
          message: "Database is temporarily unavailable"
        });
      }

      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to confirm checkout payment"
      });
    }
  });
}

function isCheckoutTerminalStatus(status: string) {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "UNDER_REVIEW"].includes(status);
}

function isTemporaryDatabaseError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1000", "P1001", "P1002", "P2024", "P2028"].includes(error.code)
  );
}
