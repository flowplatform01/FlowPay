import assert from "node:assert/strict";
import { classifyPaymentFailure } from "./payment-failure-semantics.js";

function expectFailure(
  payload: Record<string, unknown>,
  expected: ReturnType<typeof classifyPaymentFailure>
) {
  assert.deepEqual(classifyPaymentFailure(payload), expected);
}

expectFailure(
  { status: "FAILED", message: "Insufficient balance on wallet" },
  {
    kind: "INSUFFICIENT_FUNDS",
    transactionStatus: "FAILED",
    customerMessage: "Insufficient funds. Please add funds or use another payment method.",
    retryable: false
  }
);

expectFailure(
  { status: "CANCELLED", reason: "Customer cancelled prompt" },
  {
    kind: "CANCELLED",
    transactionStatus: "CANCELLED",
    customerMessage: "Payment was cancelled.",
    retryable: false
  }
);

expectFailure(
  { status: "FAILED", message: "Authorization expired" },
  {
    kind: "EXPIRED",
    transactionStatus: "EXPIRED",
    customerMessage: "Payment authorization expired. Please start again.",
    retryable: false
  }
);

expectFailure(
  { httpStatus: 503, message: "Gateway service unavailable" },
  {
    kind: "PROVIDER_UNAVAILABLE",
    transactionStatus: "PROCESSING",
    customerMessage: "The payment service is temporarily unavailable. Your payment is still being checked.",
    retryable: true
  }
);

assert.deepEqual(
  classifyPaymentFailure(
    { status: "FAILED", message: "Gateway service unavailable" },
    { providerReportedTerminal: true }
  ),
  {
    kind: "UNKNOWN",
    transactionStatus: "FAILED",
    customerMessage: "Payment could not be completed. Please try again.",
    retryable: false
  }
);

console.log("PAYMENT_FAILURE_SEMANTICS_TEST_OK");
