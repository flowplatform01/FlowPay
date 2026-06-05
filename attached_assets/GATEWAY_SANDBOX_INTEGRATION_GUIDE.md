# FlowPay — Real Sandbox Gateway Integration Guide

This guide is tailored to **this repository** (`Flowpay/`, `flow-admin/`, `flowpay-external-test-app/`). It replaces generic gateway tutorials with exact paths, env vars, URLs, and test flows used by FlowPay today.

**Audience:** You are connecting real provider sandboxes (CamPay first, then CinetPay, Maviance) while still developing locally.

**Rule:** End users never see CamPay, CinetPay, or Maviance. They only see payment methods (MTN Mobile Money, Orange Money, Card & Wallet, Bank Transfer). Routing is internal — see `services/api/src/modules/payments/payment-channels.ts`.

---

## 1. How FlowPay talks to gateways

| Layer | Location | Role |
|--------|----------|------|
| Public payment methods | `payment-channels.ts` | Maps UX labels → internal `CAMPAY` / `MAVIANCE` / `CINETPAY` |
| Adapter factory | `gateways/gateways.service.ts` | Real adapter if credentials exist; else `SandboxGatewayAdapter` |
| CamPay adapter | `gateways/adapters/campay.adapter.ts` | Token + `/api/collect/` |
| CinetPay adapter | `gateways/adapters/cinetpay.adapter.ts` | `/v2/payment` init |
| Maviance adapter | `gateways/adapters/maviance.adapter.ts` | `/v1/payments` skeleton |
| Internal simulator | `gateways/adapters/sandbox.adapter.ts` | Used when provider env creds are empty |
| Webhook ingress | `POST /api/v1/webhooks/:provider` | `webhooks.routes.ts` |
| Webhook reconciliation | `webhooks/gateway-webhook.service.ts` | Updates transaction status from provider payload |
| Hosted checkout confirm | `checkout/checkout.service.ts` | `POST .../confirm` → `adapter.charge(phase: "capture")` |

**Adapter mode**

- Credentials set → `getActiveAdapterMode()` returns `provider-sandbox` (real HTTP to provider).
- Credentials missing → `internal-sandbox` (deterministic simulator; no external network).

Check which mode is active by inspecting API logs on charge, or temporarily log `getActiveAdapterMode("CAMPAY")` from `gateways.service.ts`.

---

## 2. Local stack (default ports)

| Service | Port | Purpose |
|---------|------|---------|
| FlowPay API | `3011` | `services/api` — payments, webhooks |
| Checkout web | `3010` | `apps/checkout-web` — hosted checkout UI |
| External test app | `3025` | `flowpay-external-test-app` — merchant demo + bottom sheet |
| Flow Admin API | `5001` | Org/app/transaction admin |
| Flow Admin UI | `5173` | Dashboard |

Copy env from `Flowpay/services/api/.env.example` → `Flowpay/services/api/.env`.

Critical vars:

```env
PORT=3011
FLOWPAY_PUBLIC_URL=http://localhost:3010
FLOW_ADMIN_URL=http://localhost:5001
FLOWPAY_WEBHOOK_BASE_URL=https://YOUR-TUNNEL-HOST   # required for real provider webhooks
```

`env.gatewayWebhookUrl("CAMPAY")` resolves to:

`{FLOWPAY_WEBHOOK_BASE_URL or http://127.0.0.1:3011}/api/v1/webhooks/CAMPAY`

Use **uppercase** provider in the URL path: `CAMPAY`, `CINETPAY`, `MAVIANCE`.

---

## 3. Webhooks on localhost (tunnel required)

Providers cannot call `http://127.0.0.1:3011` from the internet. For real sandbox webhooks you need a tunnel:

**Option A — ngrok (common)**

```bash
ngrok http 3011
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) into `.env`:

```env
FLOWPAY_WEBHOOK_BASE_URL=https://abc123.ngrok-free.app
```

Restart the API after changing env.

**Option B — Cloudflare Tunnel**

```bash
cloudflared tunnel --url http://127.0.0.1:3011
```

Use the generated `https://*.trycloudflare.com` URL the same way.

**Webhook URLs to register at each provider**

| Provider | Register this notify URL |
|----------|---------------------------|
| CamPay | `https://YOUR-TUNNEL/api/v1/webhooks/CAMPAY` |
| CinetPay | `https://YOUR-TUNNEL/api/v1/webhooks/CINETPAY` (also sent in `notify_url` on init) |
| Maviance | `https://YOUR-TUNNEL/api/v1/webhooks/MAVIANCE` |

**Security**

- CamPay: HMAC SHA-256 via `CAMPAY_WEBHOOK_SECRET` (falls back to `WEBHOOK_SIGNING_SECRET`). Header: `x-campay-signature` or `x-flowpay-signature`.
- Invalid signature → `401`, logged in `WebhookLog`, transaction **not** updated.
- Duplicate webhook with same terminal status → deduplicated (no double settlement).

**Avoid confusion**

- One tunnel URL per developer machine; use different provider paths, not different tunnels.
- Do not point CamPay and CinetPay to different local ports unless you run multiple API instances.

---

## 4. CamPay sandbox (start here)

You are at **application registration** on CamPay. Below is what to enter now vs later.

### 4.1 CamPay environments

| Environment | Base URL | When to use |
|-------------|----------|-------------|
| Demo / sandbox | `https://demo.campay.net` | Now (default in `env.ts` and seed) |
| Production | `https://www.campay.net` or provider docs | After go-live only |

Set in `.env`:

```env
CAMPAY_BASE_URL=https://demo.campay.net
CAMPAY_USERNAME=<app username from CamPay portal>
CAMPAY_PASSWORD=<app password from CamPay portal>
CAMPAY_WEBHOOK_SECRET=<webhook signing secret from portal>
```

Aliases `CAMPAY_API_KEY` / `CAMPAY_API_SECRET` still map to username/password.

### 4.2 Application registration fields (local dev)

| Field | Safe value now | Change for production |
|-------|----------------|------------------------|
| Application name | `FlowPay Sandbox` or your company product name | Same or branded prod name |
| Description | Short: "Payment orchestration sandbox for Flow ecosystem" | Production marketing copy |
| Website URL | `http://localhost:3010` or `https://your-company.com` if you have a staging site | Live marketing site `https://...` |
| Logo | Any square PNG (128–512px); placeholder is fine | Official brand asset |
| Redirect / return URL (if asked) | `http://localhost:3010/checkout` | `https://checkout.yourdomain.com/checkout` |
| Webhook / callback URL | `https://YOUR-NGROK/api/v1/webhooks/CAMPAY` | `https://api.yourdomain.com/api/v1/webhooks/CAMPAY` |
| Support email | Your real email | Same |
| Country / currency | Cameroon / XAF (if applicable) | Live operating countries |

**Temporary placeholders are OK** for website and logo during sandbox. **Not OK** for webhook secret handling — store secrets only in `.env`, never in git.

### 4.3 CamPay dashboard → FlowPay `.env` mapping

| CamPay portal field | Put in `.env` | Used by FlowPay server? |
|---------------------|---------------|-------------------------|
| **App Username** | `CAMPAY_USERNAME` | Yes — `/api/token/` |
| **App Password** | `CAMPAY_PASSWORD` | Yes |
| **Permanent Access token** | `CAMPAY_ACCESS_TOKEN` (optional) | Yes — skips token call if set |
| **App webhook key** | `CAMPAY_WEBHOOK_SECRET` | Yes — verifies incoming webhooks |
| **App ID** | `CAMPAY_APP_ID` | No — widget/SDK only; ignore “Widget integration” |
| **Widget JS snippet** | — | Do not embed in FlowPay; checkout uses server `/api/collect/` |

Verify credentials:

```bash
cd Flowpay/services/api
npm run verify:campay
```

Expect `auth: OK` and balance payload from demo.

### 4.4 After approval — collect credentials

1. Username + password (API auth) → `CAMPAY_USERNAME`, `CAMPAY_PASSWORD`
2. Webhook signing secret → `CAMPAY_WEBHOOK_SECRET`
3. Confirm demo base URL remains `https://demo.campay.net`

Restart API:

```bash
cd Flowpay/services/api
npm run dev
```

### 4.4 How a CamPay payment flows in FlowPay

1. Merchant app calls `POST /api/v1/payments/initialize` with `deferCapture: true` (default) → transaction `PENDING`, checkout session token in metadata.
2. User opens hosted checkout (`FLOWPAY_PUBLIC_URL/checkout/:id?token=...`).
3. User picks **MTN Mobile Money** → maps to `CAMPAY`.
4. User confirms → `POST /api/v1/checkout/session/:id/confirm` → `CampayGatewayAdapter.charge()` → `POST /api/collect/` with `external_reference` = FlowPay `transaction.id`.
5. CamPay returns `PENDING` + `reference` → stored on `PaymentAttempt.gatewayReference`.
6. User completes MoMo on phone → CamPay sends webhook → FlowPay sets transaction `SUCCEEDED` or `FAILED`.

**Requirement:** `customerPhone` on initialize (E.164-ish, e.g. `237670000001`). Without it, CamPay adapter returns `FAILED` immediately.

Example initialize body (external test app does this):

```json
{
  "amount": 5000,
  "currency": "XAF",
  "externalReference": "order-123",
  "customerName": "Test User",
  "customerPhone": "237670000001",
  "paymentMethod": "MTN_MOMO",
  "deferCapture": true
}
```

### 4.5 First CamPay sandbox test

1. Start Redis + Postgres, migrate/seed if needed.
2. Start API (`3011`), checkout (`3010`), external app (`3025`).
3. Start ngrok → set `FLOWPAY_WEBHOOK_BASE_URL` → restart API.
4. Register webhook URL in CamPay portal.
5. Open `http://localhost:3025`, pay with MTN MoMo, use sandbox test number from CamPay docs.
6. Verify:
   - API log: token + collect calls
   - Transaction → `PROCESSING` then `SUCCEEDED` after webhook
   - `WebhookLog.processed = true` in DB / Flow Admin
   - External app bottom sheet shows success only when status is `SUCCEEDED`

### 4.6 CamPay failure / timeout testing

| Scenario | How to trigger | Expected |
|----------|----------------|----------|
| Declined collect | Invalid phone or CamPay sandbox decline | `FAILED`, `failureReason` set |
| Missing phone | Omit `customerPhone` on initialize | Immediate adapter failure on confirm |
| Webhook delay | Normal MoMo delay | UI stays processing until webhook |
| Bad webhook signature | Wrong `CAMPAY_WEBHOOK_SECRET` | `401`, no status change |
| Idempotent webhook | Replay same success payload | `deduplicated: true` in response |

### 4.7 CamPay risks and limits

- Async MoMo: success UI must not assume synchronous `collect` response — webhooks are authoritative.
- Demo credentials only on demo base URL.
- Rate limits and IP allowlists may apply in production.
- USSD / operator specifics are on CamPay side; FlowPay only orchestrates.

---

## 5. CinetPay sandbox

### 5.1 Account setup

1. Create account at [CinetPay](https://cinetpay.com/) (merchant).
2. Open **sandbox** / test mode in merchant back-office.
3. Create a **site** → note `site_id`.
4. Copy **API key** (and secret if separate).

### 5.2 Environment

```env
CINETPAY_BASE_URL=https://api-checkout.cinetpay.com
CINETPAY_API_KEY=<sandbox api key>
CINETPAY_SITE_ID=<sandbox site id>
CINETPAY_SECRET=<for webhook verification — implement full HMAC when CinetPay doc is wired>
FLOWPAY_WEBHOOK_BASE_URL=https://YOUR-TUNNEL
```

Public methods **Card & Wallet** and **Bank Transfer** route to `CINETPAY` (`payment-channels.ts`).

### 5.3 URLs to configure

| Purpose | URL |
|---------|-----|
| Notify (server) | `https://YOUR-TUNNEL/api/v1/webhooks/CINETPAY` |
| Return (browser) | `http://localhost:3010/checkout/{transactionId}` (auto-built in adapter) |

CinetPay init sends `notify_url` via `env.gatewayWebhookUrl("CINETPAY")`.

### 5.4 Testing

1. Set creds → restart API → confirm `provider-sandbox` for CINETPAY.
2. Pay via checkout with **Card & Wallet**.
3. Complete CinetPay hosted payment page (sandbox cards per their docs).
4. Confirm webhook updates transaction and merchant webhook queue fires.

**Note:** `verifyWebhookSignature` in `cinetpay.adapter.ts` is minimal until you paste CinetPay’s exact HMAC rules from their v2 docs. Treat webhook hardening as a follow-up before production.

---

## 6. Maviance sandbox

### 6.1 Account setup

1. Request Maviance / Smobilpay sandbox credentials from your account manager or developer portal.
2. Obtain API key + secret and sandbox base URL (default in code: `https://api.maviance.com` — confirm with your contract).

### 6.2 Environment

```env
MAVIANCE_BASE_URL=https://api.maviance.com
MAVIANCE_API_KEY=<sandbox key>
MAVIANCE_SECRET=<sandbox secret>
FLOWPAY_WEBHOOK_BASE_URL=https://YOUR-TUNNEL
```

**Orange Money** in checkout maps to `MAVIANCE`.

### 6.3 Webhook

Register: `https://YOUR-TUNNEL/api/v1/webhooks/MAVIANCE`

The adapter skeleton posts to `/v1/payments` — **finalize path and payload fields** against your signed Maviance API PDF before production.

### 6.4 Testing

Same pattern as CamPay: initialize → checkout → confirm → await webhook → verify Flow Admin + external app.

---

## 7. Sandbox vs live separation

| Concern | Sandbox | Production |
|---------|---------|------------|
| Base URLs | `demo.campay.net`, CinetPay sandbox, Maviance sandbox host | Provider production hosts |
| Credentials | Separate keys per environment | Never reuse sandbox secrets |
| `FLOWPAY_WEBHOOK_BASE_URL` | ngrok / staging API URL | `https://api.yourdomain.com` |
| `FLOWPAY_PUBLIC_URL` | `localhost:3010` | `https://checkout.yourdomain.com` |
| DB `GatewayConfig` | Seeded sandbox `baseUrl` in `prisma/seed.ts` | Update via Flow Admin / ops runbook |
| Adapter mode | `provider-sandbox` only when env creds present | Same code path, different env file |

Use separate `.env` files or secret manager entries per environment. Never commit `.env`.

---

## 8. End-to-end testing checklist

### 8.1 Services up

```bash
# From Flowpay/
docker compose up -d redis
npm run prisma:migrate
npm run prisma:seed
npm run dev:api          # 3011
npm run dev:checkout     # 3010
# External app (repo root)
cd flowpay-external-test-app && npm start   # 3025
```

### 8.2 Automated (internal sandbox — no provider creds)

```bash
cd flowpay-external-test-app
npx playwright test
```

Expect 2 passing specs (checkout iframe + success path) against internal simulator.

### 8.3 Manual (real provider sandbox)

- [ ] Tunnel running, `FLOWPAY_WEBHOOK_BASE_URL` set
- [ ] Provider webhook URL registered
- [ ] Successful payment → `SUCCEEDED`, settlement row, app webhook queued
- [ ] Failed payment → `FAILED`, checkout shows failure
- [ ] Flow Admin: transaction visible, webhook log `processed`
- [ ] External app: bottom sheet success **only** after real `SUCCEEDED`
- [ ] Replay webhook from Flow Admin internal route if configured

### 8.4 Reconciliation

1. Match `PaymentAttempt.gatewayReference` to provider reference in portal.
2. Match `Transaction.id` to `external_reference` in CamPay collect/webhook.
3. Compare amounts: `grossAmount` vs provider payload.

---

## 9. Flow Admin visibility

- Transactions: org/app views (existing Flow Admin integration).
- Webhook logs: `WebhookLog` table — signature valid, `processed`, `transactionId`, `errorMessage`.
- Internal replay: `POST /api/v1/internal/webhooks/:id/replay` (requires `FLOWPAY_INTERNAL_TOKEN`).

Gateway names stay internal; admin UI should not rebrand user-facing copy as CamPay/CinetPay.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Still on internal simulator | Empty `CAMPAY_USERNAME` / `PASSWORD` | Set creds, restart API |
| `401` on webhook | Wrong `CAMPAY_WEBHOOK_SECRET` | Copy from portal, restart |
| Transaction stuck `PROCESSING` | Webhook not received | Tunnel down / wrong URL / firewall |
| Transaction not found in webhook | Reference mismatch | Ensure `external_reference` = transaction id |
| Collect fails immediately | Missing `customerPhone` | Pass phone on initialize |
| Checkout blank iframe | Dev Next slow | Use `npm run build && npm run start` on checkout for E2E |
| CORS / frame blocked | Parent origin not allowed | `checkout-web/next.config.ts` `frame-ancestors` |

---

## 11. Production cutover (later)

1. Replace all sandbox base URLs and credentials.
2. Set `FLOWPAY_WEBHOOK_BASE_URL` to public API domain (no tunnel).
3. Set `FLOWPAY_PUBLIC_URL` to production checkout CDN/domain.
4. Complete CinetPay / Maviance webhook HMAC verification per official docs.
5. Enable monitoring on webhook `401` rate and `PROCESSING` age.
6. Run penetration review on webhook endpoints (no auth bypass in production).

---

## 12. Quick reference — files to touch

| Task | File |
|------|------|
| Add / rotate CamPay secrets | `Flowpay/services/api/.env` |
| Webhook URL helper | `Flowpay/services/api/src/config/env.ts` |
| CamPay HTTP logic | `.../adapters/campay.adapter.ts` |
| Webhook → transaction | `.../webhooks/gateway-webhook.service.ts` |
| Payment method labels | `.../payments/payment-channels.ts` |
| Seed sandbox URLs | `Flowpay/services/api/prisma/seed.ts` |
| External merchant demo | `flowpay-external-test-app/` |

---

**Next step for you:** Finish CamPay application registration using section 4.2, start ngrok, paste tunnel URL into `FLOWPAY_WEBHOOK_BASE_URL`, add username/password/webhook secret to `.env`, restart API, and run your first real collect from `http://localhost:3025`.
