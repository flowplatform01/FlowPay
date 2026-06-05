import dotenv from "dotenv";

dotenv.config();

const baseUrl = (process.env.CAMPAY_BASE_URL ?? "https://demo.campay.net").replace(/\/$/, "");
const permanentToken = process.env.CAMPAY_ACCESS_TOKEN?.trim();
const username = process.env.CAMPAY_USERNAME?.trim();
const password = process.env.CAMPAY_PASSWORD?.trim();
const webhookBase = process.env.FLOWPAY_WEBHOOK_BASE_URL?.trim();

async function fetchToken() {
  if (permanentToken) {
    return { token: permanentToken, source: "CAMPAY_ACCESS_TOKEN" };
  }

  if (!username || !password) {
    throw new Error("Set CAMPAY_USERNAME + CAMPAY_PASSWORD or CAMPAY_ACCESS_TOKEN");
  }

  const response = await fetch(`${baseUrl}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Token failed HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  const token = String(body.token ?? body.access_token ?? "");
  if (!token) {
    throw new Error(`Token response missing token field: ${JSON.stringify(body)}`);
  }

  return { token, source: "/api/token/" };
}

async function main() {
  console.log("CamPay connectivity check");
  console.log(`  baseUrl: ${baseUrl}`);
  console.log(`  webhook: ${webhookBase ? `${webhookBase}/api/v1/webhooks/CAMPAY` : "(set FLOWPAY_WEBHOOK_BASE_URL for public webhooks)"}`);

  const { token, source } = await fetchToken();
  console.log(`  auth: OK via ${source}`);

  const statusResponse = await fetch(`${baseUrl}/api/balance/`, {
    headers: { Authorization: `Token ${token}` }
  });

  if (statusResponse.ok) {
    const balance = await statusResponse.json().catch(() => ({}));
    console.log("  balance endpoint: OK");
    console.log(`  balance payload: ${JSON.stringify(balance)}`);
  } else {
    console.log(`  balance endpoint: HTTP ${statusResponse.status} (non-fatal; collect may still work)`);
  }

  console.log("\nNext: ngrok http 3011 → set FLOWPAY_WEBHOOK_BASE_URL → register webhook in CamPay Settings");
  console.log("Test pay: http://localhost:3025 (MTN MoMo + customerPhone)");
}

main().catch((error) => {
  console.error("CamPay verify failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
