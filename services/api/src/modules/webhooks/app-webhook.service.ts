import type { Prisma, TransactionStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/db.js";
import { signPayload } from "../../utils/crypto.js";

type AppWebhookPayload = {
  id: string;
  type: string;
  createdAt: string;
  data: {
    transaction: {
      id: string;
      externalReference: string;
      status: TransactionStatus;
      amount: number;
      grossAmount: number;
      currency: string;
      selectedProvider: string;
      customerEmail: string | null;
      customerPhone: string | null;
      metadata: unknown;
      createdAt: string;
      updatedAt: string;
    };
  };
};

export async function dispatchAppWebhook(input: {
  transactionId: string;
  eventType: string;
  attempt: number;
}) {
  const transaction = await prisma.transaction.findUnique({
    where: { id: input.transactionId },
    include: {
      app: true
    }
  });

  if (!transaction) {
    throw new Error(`Transaction ${input.transactionId} not found for webhook dispatch`);
  }

  if (!transaction.app.webhookUrl) {
    await recordWebhookDispatch({
      transactionId: transaction.id,
      eventType: input.eventType,
      status: "SUCCEEDED",
      attempts: input.attempt,
      reason: "App webhook URL is not configured",
      payload: { skipped: true }
    });
    return { delivered: false, skipped: true };
  }

  const payload: AppWebhookPayload = {
    id: `evt_${transaction.id}_${input.eventType}_${Date.now()}`,
    type: input.eventType,
    createdAt: new Date().toISOString(),
    data: {
      transaction: {
        id: transaction.id,
        externalReference: transaction.externalReference,
        status: transaction.status,
        amount: Number(transaction.amount),
        grossAmount: Number(transaction.grossAmount),
        currency: transaction.currency,
        selectedProvider: transaction.selectedProvider,
        customerEmail: transaction.customerEmail,
        customerPhone: transaction.customerPhone,
        metadata: transaction.metadata,
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString()
      }
    }
  };

  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(transaction.app.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "FlowPay-Webhooks/1.0",
        "x-flowpay-event-id": payload.id,
        "x-flowpay-event-type": input.eventType,
        "x-flowpay-signature": signPayload(body, env.WEBHOOK_SIGNING_SECRET)
      },
      body,
      signal: controller.signal
    });

    const responseText = await response.text().catch(() => "");

    await recordWebhookDispatch({
      transactionId: transaction.id,
      eventType: input.eventType,
      status: response.ok ? "SUCCEEDED" : "FAILED",
      attempts: input.attempt,
      reason: response.ok
        ? `Delivered app webhook with HTTP ${response.status}`
        : `App webhook failed with HTTP ${response.status}`,
      payload: {
        eventId: payload.id,
        webhookUrl: transaction.app.webhookUrl,
        httpStatus: response.status,
        responseBody: responseText.slice(0, 2_000)
      }
    });

    if (!response.ok) {
      throw new Error(`App webhook failed with HTTP ${response.status}`);
    }

    return { delivered: true, statusCode: response.status, eventId: payload.id };
  } catch (error) {
    await recordWebhookDispatch({
      transactionId: transaction.id,
      eventType: input.eventType,
      status: "FAILED",
      attempts: input.attempt,
      reason: error instanceof Error ? error.message : "App webhook dispatch failed",
      payload: {
        webhookUrl: transaction.app.webhookUrl
      }
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchAppRevenuePayoutWebhook(input: {
  revenuePayoutId: string;
  eventType: string;
  attempt: number;
}) {
  const payout = await prisma.revenuePayout.findUnique({
    where: { id: input.revenuePayoutId },
    include: {
      organization: true
    }
  });

  if (!payout) {
    throw new Error(`Revenue payout ${input.revenuePayoutId} not found for webhook dispatch`);
  }

  const metadata =
    payout.metadata && typeof payout.metadata === "object" && !Array.isArray(payout.metadata)
      ? (payout.metadata as Record<string, unknown>)
      : {};
  const appId = typeof metadata.appId === "string" ? metadata.appId : null;

  if (!appId) {
    await recordWebhookDispatch({
      transactionId: null,
      eventType: input.eventType,
      status: "SUCCEEDED",
      attempts: input.attempt,
      reason: "Revenue payout is not app-facing",
      payload: { skipped: true, revenuePayoutId: payout.id }
    });
    return { delivered: false, skipped: true };
  }

  const app = await prisma.app.findUnique({
    where: { id: appId }
  });

  if (!app?.webhookUrl) {
    await recordWebhookDispatch({
      transactionId: null,
      eventType: input.eventType,
      status: "SUCCEEDED",
      attempts: input.attempt,
      reason: "App webhook URL is not configured",
      payload: { skipped: true, revenuePayoutId: payout.id, appId }
    });
    return { delivered: false, skipped: true };
  }

  const externalReference =
    typeof metadata.externalReference === "string" ? metadata.externalReference : payout.id;
  const status =
    input.eventType.includes("success")
      ? "SUCCEEDED"
      : input.eventType.includes("fail")
        ? "FAILED"
        : "UNDER_REVIEW";
  const payload = {
    id: `evt_${payout.id}_${input.eventType}_${Date.now()}`,
    type: input.eventType,
    createdAt: new Date().toISOString(),
    data: {
      transaction: {
        id: payout.id,
        externalReference,
        status,
        amount: Number(payout.amount),
        grossAmount: Number(payout.amount),
        currency: payout.currency,
        selectedProvider: payout.provider,
        customerEmail: null,
        customerPhone: null,
        metadata,
        createdAt: payout.createdAt.toISOString(),
        updatedAt: payout.updatedAt.toISOString()
      }
    }
  };
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(app.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "FlowPay-Webhooks/1.0",
        "x-flowpay-event-id": payload.id,
        "x-flowpay-event-type": input.eventType,
        "x-flowpay-signature": signPayload(body, env.WEBHOOK_SIGNING_SECRET)
      },
      body,
      signal: controller.signal
    });

    const responseText = await response.text().catch(() => "");

    await recordWebhookDispatch({
      transactionId: null,
      eventType: input.eventType,
      status: response.ok ? "SUCCEEDED" : "FAILED",
      attempts: input.attempt,
      reason: response.ok
        ? `Delivered app revenue payout webhook with HTTP ${response.status}`
        : `App revenue payout webhook failed with HTTP ${response.status}`,
      payload: {
        eventId: payload.id,
        revenuePayoutId: payout.id,
        appId,
        webhookUrl: app.webhookUrl,
        httpStatus: response.status,
        responseBody: responseText.slice(0, 2_000)
      }
    });

    if (!response.ok) {
      throw new Error(`App revenue payout webhook failed with HTTP ${response.status}`);
    }

    return { delivered: true, statusCode: response.status, eventId: payload.id };
  } catch (error) {
    await recordWebhookDispatch({
      transactionId: null,
      eventType: input.eventType,
      status: "FAILED",
      attempts: input.attempt,
      reason: error instanceof Error ? error.message : "App revenue payout webhook dispatch failed",
      payload: {
        revenuePayoutId: payout.id,
        appId,
        webhookUrl: app.webhookUrl
      }
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function recordWebhookDispatch(input: {
  transactionId: string | null;
  eventType: string;
  status: "SUCCEEDED" | "FAILED";
  attempts: number;
  reason: string;
  payload: Record<string, unknown>;
}) {
  await prisma.retryJob.create({
    data: {
      transactionId: input.transactionId,
      queueName: "webhook-queue",
      reason: input.reason,
      status: input.status,
      attempts: input.attempts,
      payload: {
        eventType: input.eventType,
        ...input.payload
      } as Prisma.InputJsonValue
    }
  });
}
