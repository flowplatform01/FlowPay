/**
 * Confirmation Gateway contract checks against a running FlowPay API + checkout-web stack.
 * Usage: node scripts/confirmation-gateway.contract.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = join(root, "..");
const testEnv = loadEnv(join(repoRoot, "flowTestSpace/flowpay-external-test-app/.env.local"));
const apiBase = process.env.FLOWPAY_BASE_URL ?? testEnv.FLOWPAY_BASE_URL ?? "http://127.0.0.1:3011";
const checkoutBase = process.env.FLOWPAY_CHECKOUT_URL ?? testEnv.FLOWPAY_CHECKOUT_URL ?? "http://127.0.0.1:3010";

const headers = {
  "content-type": "application/json",
  "x-flowpay-public-key": testEnv.FLOWPAY_PUBLIC_KEY,
  "x-flowpay-secret-key": testEnv.FLOWPAY_SECRET_KEY
};

const recipientRef = `contract-recipient-${Date.now()}`;

async function main() {
  await assertOk(`${apiBase}/api/v1/health`, "FlowPay API health");

  const createResponse = await fetch(`${apiBase}/api/v1/destination-profiles`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      externalRecipientId: recipientRef,
      providerType: "CAMPAY",
      payoutTarget: "+237677777777",
      settlementStrategy: "TWO_STEP_MIRROR",
      regionalCurrency: "XAF",
      supportedRails: ["MOBILE_MONEY"],
      providerMetadata: { displayName: "Contract Test Recipient" },
      routingPreferences: { preferredMethod: "MTN_MOMO" }
    })
  });

  const created = await createResponse.json();
  assert(createResponse.ok, `destination profile create failed: ${JSON.stringify(created)}`);
  assert(created.confirmationUrl, "confirmationUrl missing from provisioning response");
  assert(created.confirmationRequired === true, "confirmationRequired should be true");

  const sessionUrl = new URL(created.confirmationUrl);
  assert(sessionUrl.pathname.includes("/recipient-confirm/"), "confirmation URL must target checkout-web");

  const token = sessionUrl.searchParams.get("token");
  const profileId = sessionUrl.pathname.split("/").pop();
  assert(token && profileId, "confirmation URL must include profile id and token");

  const sessionResponse = await fetch(
    `${apiBase}/api/v1/checkout/recipient/${profileId}?token=${encodeURIComponent(token)}`
  );
  const session = await sessionResponse.json();
  assert(sessionResponse.ok, `confirmation session failed: ${JSON.stringify(session)}`);
  assert(session.workflow === "RECIPIENT_SETUP", "workflow must be RECIPIENT_SETUP");
  assert(!("providerType" in session), "providerType must not leak to confirmation session");
  assert(session.paymentRailLabel, "paymentRailLabel required");
  assert(session.editableFields?.includes("payoutTarget"), "payoutTarget must be editable");
  assert(session.capacityEligibility, "capacityEligibility required on confirmation session");
  assert(typeof session.capacityEligibility.canActivate === "boolean", "canActivate required");

  const approveResponse = await fetch(
    `${apiBase}/api/v1/checkout/recipient/${profileId}/approve?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payoutTarget: "+237677777778" })
    }
  );
  const approved = await approveResponse.json();
  assert(approveResponse.ok, `approve failed: ${JSON.stringify(approved)}`);
  assert(approved.status === "VERIFIED", "approve must return VERIFIED");

  const statusResponse = await fetch(`${apiBase}/api/v1/destination-profiles/${encodeURIComponent(recipientRef)}`, {
    headers
  });
  const status = await statusResponse.json();
  assert(statusResponse.ok, `status lookup failed: ${JSON.stringify(status)}`);
  assert(status.verificationStatus === "VERIFIED", "profile must be verified after approval");

  const balanceResponse = await fetch(`${apiBase}/api/v1/credits/balance`, { headers });
  const balance = await balanceResponse.json();
  assert(balanceResponse.ok, `credit balance failed: ${JSON.stringify(balance)}`);
  assert(typeof balance.effectiveBalance === "number", "effectiveBalance required");

  await assertOk(`${checkoutBase}/recipient-confirm/${profileId}?token=${encodeURIComponent(token)}`, "checkout recipient page");

  console.log("CONFIRMATION_GATEWAY_CONTRACT_OK");
}

function loadEnv(path) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .reduce((values, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return values;
        const separator = trimmed.indexOf("=");
        if (separator === -1) return values;
        values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
        return values;
      }, {});
  } catch {
    return {};
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertOk(url, label) {
  const response = await fetch(url);
  assert(response.ok, `${label} unavailable at ${url} (${response.status})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
