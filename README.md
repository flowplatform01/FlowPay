# FlowPay

FlowPay is the payment orchestration infrastructure for the Flow ecosystem.

## Workspace Layout

- `services/api` - Fastify API, Prisma schema, BullMQ workers, gateway adapters
- `apps/checkout-web` - Next.js checkout and hosted payment surface
- `packages/sdk` - browser-facing FlowPay SDK client foundation
- `../flow-admin` - existing Flow Admin platform with integrated FlowPay management pages

## Core Capabilities

- multi-tenant app registration and API key model
- transaction orchestration with idempotency
- fee and settlement breakdowns
- gateway adapter architecture for CamPay, Maviance, CinetPay
- webhook verification and replay foundation
- Redis-backed queues with BullMQ
- Swagger docs
- checkout UI foundation for embedded payment flow

## Setup

1. Install dependencies

```bash
npm install
```

2. Create environment files

- `Flowpay/.env`
- `flow-admin/frontend/.env` with `VITE_FLOWPAY_API_URL=http://localhost:3100`

3. Start Redis

```bash
docker compose up -d redis
```

4. Migrate and seed database

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

5. Run apps

```bash
npm run dev:api
npm run dev:checkout
```
