# FlowPay Production Runtime Checklist

Use this checklist after deployment or whenever Flow Admin shows `FlowPay request failed`.

## 1. Render Build and Start Commands

Use these exact commands per Render service. Keep each service separate.

### FlowPay API

Render service:

- Type: Web Service
- Root directory: `FlowPay`
- Runtime: Node, or Docker using `FlowPay/Dockerfile`
- Health path: `/api/v1/health`

Node build/start:

```bash
npm install && npm run build --workspace @flowpay/api
npm run start --workspace @flowpay/api
```

Docker:

```text
Dockerfile: FlowPay/Dockerfile
```

Expected log behavior:

- API/server startup only.
- No queue worker startup logs.

### FlowPay Worker

Render service:

- Type: Background Worker
- Root directory: `FlowPay`
- Runtime: Node, or Docker using `FlowPay/Dockerfile.worker`

Node build/start:

```bash
npm install && npm run build --workspace @flowpay/api
npm run start:worker --workspace @flowpay/api
```

Docker:

```text
Dockerfile: FlowPay/Dockerfile.worker
```

Expected log behavior:

- Worker and queue startup logs.
- No API/server startup logs.

### FlowPay Checkout Web

Render service:

- Type: Web Service
- Root directory: `FlowPay`
- Runtime: Node

Build/start:

```bash
npm install && npm run build --workspace @flowpay/checkout-web
npm run start --workspace @flowpay/checkout-web
```

### Flow Admin Backend

Render service:

- Type: Web Service
- Root directory: `flow-admin`
- Runtime: Node
- Health path: `/health`

Build/start:

```bash
npm install && npm run build --workspace backend
npm run start --workspace backend
```

### Flow Admin Frontend

Render service:

- Type: Static Site, or Web Service serving the built frontend
- Root directory: `flow-admin`

Build:

```bash
npm install && npm run build --workspace frontend
```

Static publish directory:

```text
frontend/dist
```

If using a Render web service instead of a static site:

```bash
npm run preview --workspace frontend -- --host 0.0.0.0 --port $PORT
```

### Separation Rules

- FlowPay API logs should show API/server startup only.
- FlowPay Worker logs should show queue/worker startup.
- The API service must not run `start:worker`.
- The Worker service must not run `start`.

## 2. Required Production Environment

FlowPay API:

```env
DATABASE_URL=...
REDIS_URL=...
JWT_SECRET=...
ENCRYPTION_KEY=...
WEBHOOK_SIGNING_SECRET=...
FLOWPAY_INTERNAL_TOKEN=...
FLOWPAY_PUBLIC_URL=https://<flowpay-checkout-url>
FLOW_ADMIN_URL=https://<flow-admin-url>
FLOWPAY_WEBHOOK_BASE_URL=https://<flowpay-api-url>
FAPSHI_API_KEY_USER=...
FAPSHI_API_KEY=...
FAPSHI_WEBHOOK_SECRET=...
NODE_ENV=production
```

FlowPay Worker:

```env
DATABASE_URL=...
REDIS_URL=...
JWT_SECRET=...
ENCRYPTION_KEY=...
WEBHOOK_SIGNING_SECRET=...
FLOWPAY_INTERNAL_TOKEN=...
FAPSHI_API_KEY_USER=...
FAPSHI_API_KEY=...
FAPSHI_WEBHOOK_SECRET=...
NODE_ENV=production
```

FlowPay automatically applies a conservative Prisma connection pool cap. Do not add DB pool variables unless deliberately tuning a larger database plan.

Provider credentials must be present on both FlowPay API and FlowPay Worker.
The API creates hosted checkout sessions, but the Worker executes queued provider captures and payouts.
If API has provider credentials but Worker does not, checkout can initialize successfully and then fail during confirmation with a provider-not-configured message.

`WEBHOOK_SIGNING_SECRET` is FlowPay platform/internal fallback key material. Do not give it to onboarded applications.
Each onboarded application receives its own `fwhsec_...` webhook secret during app onboarding or webhook-secret rotation, and that per-app secret is what the application must configure as its `FLOWPAY_WEBHOOK_SECRET`.

Flow Admin Backend:

```env
FLOWPAY_API_URL=https://<flowpay-api-url>
FLOWPAY_INTERNAL_TOKEN=<same value as FlowPay API>
NODE_ENV=production
```

Flow Admin Frontend:

```env
VITE_API_URL=https://<flow-admin-backend-url>
```

Checkout Web:

```env
NEXT_PUBLIC_FLOWPAY_API_URL=https://<flowpay-api-url>
CHECKOUT_EMBED_ORIGINS=https://<allowed-merchant-or-admin-origins>
NODE_ENV=production
```

## 3. Local Runtime Checks

From `C:\Flow.Ltd`:

```powershell
Invoke-RestMethod http://127.0.0.1:3011/api/v1/health
Invoke-RestMethod http://127.0.0.1:5001/health
netstat -ano | findstr ":3011"
netstat -ano | findstr ":3012"
netstat -ano | findstr ":5173"
```

Expected:

- FlowPay API listens on `3011`.
- FlowPay Worker health listens on `3012`.
- FlowPay Worker `/health` reports gateway runtime readiness without exposing credentials.
- Flow Admin frontend listens on `5173`.
- Flow Admin backend listens on `5001`.

## 4. Flow Admin to FlowPay Internal API Check

Use the same internal token configured in FlowPay API:

```powershell
$token = "<FLOWPAY_INTERNAL_TOKEN>"
$headers = @{ "x-flowpay-internal-token" = $token }

Invoke-RestMethod http://127.0.0.1:3011/api/v1/internal/dashboard/summary -Headers $headers
Invoke-RestMethod http://127.0.0.1:3011/api/v1/internal/apps -Headers $headers
Invoke-RestMethod http://127.0.0.1:3011/api/v1/internal/organizations -Headers $headers
Invoke-RestMethod http://127.0.0.1:3011/api/v1/internal/providers -Headers $headers
```

Production version:

```powershell
$token = "<FLOWPAY_INTERNAL_TOKEN>"
$headers = @{ "x-flowpay-internal-token" = $token }

Invoke-RestMethod https://<flowpay-api-url>/api/v1/internal/dashboard/summary -Headers $headers
Invoke-RestMethod https://<flowpay-api-url>/api/v1/internal/providers -Headers $headers
```

Expected:

- `200 OK`
- Provider list includes the full provider registry.
- No `401 Invalid internal service token`.
- No timeout or DNS error.

## 5. Provider Registry Check

From `C:\Flow.Ltd\FlowPay`:

```powershell
npm run check:providers --workspace @flowpay/api
```

Expected:

- `FAPSHI` present.
- `CAMPAY` present.
- `MAVIANCE` present.
- `CINETPAY` present.
- `FLUTTERWAVE` present.
- `MONETBIL` present.
- Active providers reflect production configuration.
- Disabled providers remain registered as standby/offline routes, not missing.

If providers are missing:

```powershell
npm run bootstrap:providers --workspace @flowpay/api
npm run check:providers --workspace @flowpay/api
```

## 6. Build Checks

From `C:\Flow.Ltd\FlowPay`:

```powershell
npm exec --workspace @flowpay/api -- tsc -p tsconfig.json --noEmit
npm run build --workspace @flowpay/api
npm run build --workspace @flowpay/checkout-web
```

From `C:\Flow.Ltd\flow-admin`:

```powershell
npm run build --workspace frontend
npm run build --workspace backend
```

If `prisma generate` fails on Windows with a DLL rename error, stop the local API/worker Node processes and rerun the build.

## 7. Flow Admin Production Failure Diagnosis

If Flow Admin shows `FlowPay request failed`, check in this order:

1. FlowPay API service is actually running API, not worker.
2. Flow Admin backend `FLOWPAY_API_URL` points to FlowPay API, not checkout/admin/worker.
3. Flow Admin backend `FLOWPAY_INTERNAL_TOKEN` exactly matches FlowPay API `FLOWPAY_INTERNAL_TOKEN`.
4. FlowPay API health endpoint returns healthy:

```powershell
Invoke-RestMethod https://<flowpay-api-url>/api/v1/health
```

5. Flow Admin backend can reach FlowPay internal endpoint:

```powershell
$headers = @{ "x-flowpay-internal-token" = "<FLOWPAY_INTERNAL_TOKEN>" }
Invoke-RestMethod https://<flowpay-api-url>/api/v1/internal/providers -Headers $headers
```

## 8. Expected Production Architecture

Correct:

```text
Flow Admin Frontend
  -> Flow Admin Backend
    -> FlowPay API
      -> Database / Redis / Providers

FlowPay Worker
  -> Redis queues
  -> Database
  -> Providers / Webhooks
```

Incorrect:

```text
FlowPay API Render service
  -> starts queue.worker
```

The API and Worker may share the same codebase and environment variables, but they must run different entrypoints.
