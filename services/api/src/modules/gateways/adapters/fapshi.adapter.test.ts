import assert from "node:assert/strict";
import { FapshiGatewayAdapter } from "./fapshi.adapter.js";

type MockResponse = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

const originalFetch = globalThis.fetch;

async function withMockFetch<T>(responses: MockResponse[], test: () => Promise<T>) {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: url.toString(), options });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call");
    }

    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body
    } as Response;
  }) as typeof fetch;

  try {
    const result = await test();
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run() {
  const adapter = new FapshiGatewayAdapter("https://fapshi.test", "api-user", "api-key", "webhook-secret");

  assert.equal(adapter.verifyWebhookSignature("{}", "webhook-secret"), true);
  assert.equal(adapter.verifyWebhookSignature("{}", "wrong-secret"), false);

  const invalidAmount = await adapter.charge({
    transactionId: "tx-small",
    amount: 99,
    currency: "XAF",
    customerPhone: "+237677777777",
    externalReference: "order-small"
  });
  assert.equal(invalidAmount.status, "FAILED");
  assert.match(String(invalidAmount.raw.message), /minimum amount/i);

  const charge = await withMockFetch(
    [{ ok: true, status: 200, body: { transId: "FP-123", status: "PENDING" } }],
    () =>
      adapter.charge({
        transactionId: "tx-123",
        amount: 100,
        currency: "XAF",
        customerPhone: "+237677777777",
        customerEmail: "payer@example.com",
        customerName: "Payer",
        externalReference: "order-123",
        phase: "capture"
      })
  );
  assert.equal(charge.result.status, "PENDING");
  assert.equal(charge.result.providerReference, "FP-123");
  assert.equal(charge.calls[0]?.url, "https://fapshi.test/direct-pay");

  const status = await withMockFetch(
    [{ ok: true, status: 200, body: { transId: "FP-123", status: "SUCCESSFUL", amount: 100 } }],
    () => adapter.getTransactionStatus("FP-123")
  );
  assert.equal(status.result.status, "SUCCESS");
  assert.equal(status.result.amount, 100);
  assert.equal(status.calls[0]?.url, "https://fapshi.test/payment-status/FP-123");

  const payout = await withMockFetch(
    [{ ok: true, status: 200, body: { transId: "PO-123", status: "PENDING" } }],
    () =>
      adapter.executePayout({
        transactionId: "tx-123",
        payoutCoordinationId: "pc-123",
        payoutTarget: "+237677777778",
        amount: 100,
        currency: "XAF",
        idempotencyKey: "payout-tx-123"
      })
  );
  assert.equal(payout.result.status, "PENDING");
  assert.equal(payout.result.providerReference, "PO-123");
  assert.equal(payout.calls[0]?.url, "https://fapshi.test/payout");
}

run()
  .then(() => {
    console.log("FAPSHI_ADAPTER_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
