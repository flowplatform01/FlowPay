import type { PaymentMethodId } from "./payment-methods";

const apiBaseUrl = process.env.NEXT_PUBLIC_FLOWPAY_API_URL ?? "http://localhost:3011";

export type CheckoutSession = {
  id: string;
  externalReference: string;
  amount: number;
  grossAmount: number;
  platformFeeAmount: number;
  gatewayFeeAmount: number;
  currency: string;
  customerName: string | null;
  organizationName: string;
  status: string;
  recipientName?: string | null;
  recipientAccount?: string | null;
  paymentDescription?: string | null;
  paymentMethod: PaymentMethodId;
  paymentMethods: Array<{
    id: PaymentMethodId;
    label: string;
    type: string;
    fee: number;
  }>;
  canConfirm: boolean;
  isCreditPurchase?: boolean;
};

export type ConfirmCheckoutResponse = CheckoutSession & {
  message: string;
};

export class CheckoutApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "CheckoutApiError";
  }
}

function apiPath(transactionId: string, token: string, suffix = "") {
  const params = new URLSearchParams({ token });
  return `${apiBaseUrl}/api/v1/checkout/session/${transactionId}${suffix}?${params.toString()}`;
}

export async function fetchCheckoutSession(transactionId: string, token: string) {
  const response = await fetch(apiPath(transactionId, token));

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new CheckoutApiError(body.message ?? "Failed to load payment session", response.status, body.code);
  }

  return (await response.json()) as CheckoutSession;
}

export function createCheckoutStatusStream(transactionId: string, token: string) {
  return new EventSource(apiPath(transactionId, token, "/events"));
}

export async function confirmCheckoutPayment(
  transactionId: string,
  token: string,
  paymentMethod: PaymentMethodId
) {
  const response = await fetch(apiPath(transactionId, token, "/confirm"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentMethod })
  });

  const body = (await response.json().catch(() => ({}))) as ConfirmCheckoutResponse & {
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new CheckoutApiError(body.message ?? "Payment confirmation failed", response.status, body.code);
  }

  return body;
}

export function isTerminalStatus(status: string) {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "UNDER_REVIEW"].includes(status);
}

export function isTransientCheckoutError(error: unknown) {
  if (error instanceof CheckoutApiError) {
    return error.statusCode >= 500 || ["P1000", "P1001", "P1002", "P2024", "P2028"].includes(error.code ?? "");
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("database is temporarily unavailable") || message.includes("temporarily unavailable");
}
