# FlowPay Deployment & Production Setup Guide

This guide covers deploying the entire FlowPay infrastructure for online production hosting using:
- **Render** for the FlowPay API & FlowPay Checkout web app
- **Northflank** (or Render Web Service) for the independent BullMQ background worker
- **Aiven PostgreSQL** for the production relational database
- **Aiven Redis** for BullMQ queues and production caching

---

## Workspace Architecture Overview

```
                        ┌──────────────────────────────────┐
                        │      Flow Admin Platform         │
                        │  (Render Static + Web Service)   │
                        └────────────────┬─────────────────┘
                                         │ Internal Token / REST
                                         ▼
┌───────────────────────┐       ┌──────────────────────────────────┐       ┌───────────────────────┐
│ Hosted Checkout Web   │──────>│           FlowPay API            │<──────│    Merchant Apps      │
│ (Render Web Service)  │ REST  │       (Render Web Service)       │ REST  │     / SDK Clients     │
└───────────────────────┘       └────────────────┬─────────────────┘       └───────────────────────┘
                                                 │
                                 ┌───────────────┴───────────────┐
                                 ▼                               ▼
                      ┌─────────────────────┐         ┌─────────────────────┐
                      │  Aiven PostgreSQL   │         │     Aiven Redis     │
                      └─────────────────────┘         └──────────┬──────────┘
                                                                 │ BullMQ Queues
                                                                 ▼
                                                      ┌─────────────────────┐
                                                      │   FlowPay Worker    │
                                                      │ (Northflank/Render) │
                                                      └─────────────────────┘
```

---

## Component Deployment Specifications

### 1. Database Setup (Aiven PostgreSQL)

1. Provision a PostgreSQL service in [Aiven Console](https://console.aiven.io/).
2. Select PostgreSQL 15 or 16.
3. Ensure SSL mode (`sslmode=require`) is enabled.
4. Obtain the connection URI (e.g. `postgresql://avro_admin:PASSWORD@postgres-123.aivencloud.com:23456/defaultdb?sslmode=require`).
5. Run migrations against Aiven PostgreSQL during deployment using Prisma:
   ```bash
   npx prisma migrate deploy
   ```

---

### 2. Redis Infrastructure (Aiven Redis)

1. Provision a Redis service in [Aiven Console](https://console.aiven.io/).
2. Obtain the TLS connection URI (scheme `rediss://`, e.g. `rediss://default:PASSWORD@redis-123.aivencloud.com:23457`).
3. FlowPay automatically enables TLS when the URL starts with `rediss://`.

---

### 3. FlowPay API Deployment (Render Web Service)

- **Service Type**: Render Web Service
- **Environment**: Node
- **Root Directory**: `FlowPay` (or repository root)
- **Dockerfile**: `FlowPay/Dockerfile` if deploying with Docker
- **Build Command**:
  ```bash
  npm install && npm run build --workspace @flowpay/api
  ```
- **Start Command**:
  ```bash
  npm run start --workspace @flowpay/api
  ```
  *(Or direct command: `cd services/api && npm run prisma:deploy && node dist/server.js`)*
- **Health Check Path**: `/api/v1/health`
- **Port**: Auto-bound via Render `PORT` env var (defaults to 3011 locally)

#### Required Environment Variables:

| Variable Name | Source / Description | Example |
|---|---|---|
| `DATABASE_URL` | Aiven PostgreSQL connection URI | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `REDIS_URL` | Aiven Redis connection URI | `rediss://default:pass@host:6379` |
| `JWT_SECRET` | Secret key for signing API tokens | `random-32-char-secret-string` |
| `ENCRYPTION_KEY` | 32-char key for DB secret encryption | `32-character-secret-key-string!` |
| `WEBHOOK_SIGNING_SECRET` | Secret for signing outgoing app webhooks | `random-secret-key` |
| `FLOWPAY_INTERNAL_TOKEN` | Shared secret with Flow Admin | `shared-internal-token-32chars` |
| `FLOWPAY_PUBLIC_URL` | Production URL of FlowPay Checkout | `https://checkout.flowpay.com` |
| `FLOW_ADMIN_URL` | Production URL of Flow Admin | `https://admin.flowpay.com` |
| `FLOWPAY_WEBHOOK_BASE_URL` | Public API URL for gateway webhooks | `https://api.flowpay.com` |
| `NODE_ENV` | Runtime mode | `production` |

---

### 4. FlowPay Background Worker (Northflank or Render Background Worker)

The worker processes BullMQ jobs (transaction retries, webhook dispatch, async charges, payout execution). It **must remain an independent process** from the API server.

- **Service Type**: Background Worker (Northflank Service / Render Background Worker)
- **Environment**: Node
- **Dockerfile**: `FlowPay/Dockerfile.worker` if deploying with Docker, or override the command to the worker start command below
- **Build Command**:
  ```bash
  npm install && npm run build --workspace @flowpay/api
  ```
- **Start Command**:
  ```bash
  npm run start:worker --workspace @flowpay/api
  ```
  *(Or direct command: `cd services/api && node dist/workers/queue.worker.js`)*

#### Required Environment Variables:
Same as the API (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FLOWPAY_INTERNAL_TOKEN`, gateway credentials).

---

### 5. FlowPay Checkout Web App (Render Web Service)

- **Service Type**: Render Web Service
- **Environment**: Node
- **Build Command**:
  ```bash
  npm install && npm run build --workspace @flowpay/checkout-web
  ```
- **Start Command**:
  ```bash
  npm run start --workspace @flowpay/checkout-web
  ```
- **Port**: Auto-bound via Render `PORT` env var

#### Required Environment Variables:

| Variable Name | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_FLOWPAY_API_URL` | Public URL of the FlowPay API | `https://api.flowpay.com` |
| `CHECKOUT_EMBED_ORIGINS` | Comma-separated allowed iframe origins | `https://merchant.com,https://admin.flowpay.com` |
| `NODE_ENV` | Production mode | `production` |

---

## Post-Deployment Verification Checklist

After deploying all components:

1. **API Health Check**:
   Query `GET https://api.flowpay.com/api/v1/health`.
   Expect response: `{"status": "ok", "database": "ok", "redis": "ok", ...}`

2. **Database Migration**:
   Verify database tables are created and seeded:
   `cd services/api && npx prisma migrate status`

3. **Worker Connectivity**:
   Check worker log logs to verify:
   `FlowPay worker ready. Queue processing is enabled.`
   `FlowPay charge worker ready. Asynchronous provider execution is enabled.`

4. **Checkout Web Session Test**:
   Create a checkout session via API `POST /api/v1/checkout/session` and open the URL in browser to verify rendering and API communication.

5. **CORS Verification**:
   Verify cross-origin requests from checkout and admin frontend succeed without CORS errors.
