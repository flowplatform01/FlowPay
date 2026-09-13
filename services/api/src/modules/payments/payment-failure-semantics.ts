import type { TransactionStatus } from "@prisma/client";

export type PaymentFailureKind =
  | "INSUFFICIENT_FUNDS"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export type PaymentFailureSemantics = {
  kind: PaymentFailureKind;
  transactionStatus: Extract<TransactionStatus, "FAILED" | "CANCELLED" | "EXPIRED" | "PROCESSING">;
  customerMessage: string;
  retryable: boolean;
};

/**
 * Converts gateway-specific failure payloads into a stable customer outcome.
 * The original payload remains on PaymentAttempt/TransactionEvent for support
 * and reconciliation; this result must be safe to expose to checkout clients.
 */
export function classifyPaymentFailure(
  payload: unknown,
  options?: { providerReportedTerminal?: boolean }
): PaymentFailureSemantics {
  const details = collectFailureDetails(payload).toLowerCase();
  const httpStatus = readHttpStatus(payload);

  if (!options?.providerReportedTerminal && (httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500 || hasAny(details, [
    "service unavailable", "temporarily unavailable", "gateway unavailable", "maintenance", "try again later"
  ]))) {
    return {
      kind: "PROVIDER_UNAVAILABLE",
      transactionStatus: "PROCESSING",
      customerMessage: "The payment service is temporarily unavailable. Your payment is still being checked.",
      retryable: true
    };
  }

  if (hasAny(details, ["insufficient fund", "insufficient balance", "not enough balance", "solde insuffisant", "low balance"])) {
    return {
      kind: "INSUFFICIENT_FUNDS",
      transactionStatus: "FAILED",
      customerMessage: "Insufficient funds. Please add funds or use another payment method.",
      retryable: false
    };
  }

  if (hasAny(details, ["cancelled", "canceled", "user cancelled", "customer cancelled", "cancel transaction"])) {
    return {
      kind: "CANCELLED",
      transactionStatus: "CANCELLED",
      customerMessage: "Payment was cancelled.",
      retryable: false
    };
  }

  if (hasAny(details, ["expired", "authorization timeout", "payment timeout", "transaction timeout"])) {
    return {
      kind: "EXPIRED",
      transactionStatus: "EXPIRED",
      customerMessage: "Payment authorization expired. Please start again.",
      retryable: false
    };
  }

  if (hasAny(details, ["declined", "rejected", "denied", "not approved", "refused"])) {
    return {
      kind: "DECLINED",
      transactionStatus: "FAILED",
      customerMessage: "Payment was declined. Please confirm the request on your phone or use another payment method.",
      retryable: false
    };
  }

  if (hasAny(details, ["invalid", "unsupported", "invalid phone", "invalid number", "invalid amount", "minimum amount"])) {
    return {
      kind: "INVALID_REQUEST",
      transactionStatus: "FAILED",
      customerMessage: "Payment details could not be accepted. Check them and try again.",
      retryable: false
    };
  }

  return {
    kind: "UNKNOWN",
    transactionStatus: "FAILED",
    customerMessage: "Payment could not be completed. Please try again.",
    retryable: false
  };
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function readHttpStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const value = (payload as Record<string, unknown>).httpStatus;
  const status = typeof value === "number" ? value : Number(value);
  return Number.isFinite(status) ? status : 0;
}

function collectFailureDetails(payload: unknown, depth = 0): string {
  if (depth > 2 || payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object" || Array.isArray(payload)) return "";

  const record = payload as Record<string, unknown>;
  return [
    record.status,
    record.reason,
    record.message,
    record.error,
    record.description,
    record.status_message,
    record.statusMessage,
    record.cpm_error_message,
    record.data
  ]
    .map((value) => collectFailureDetails(value, depth + 1))
    .filter(Boolean)
    .join(" ");
}
