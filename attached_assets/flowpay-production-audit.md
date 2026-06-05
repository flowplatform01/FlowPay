# FlowPay Production Infrastructure Audit

Audit date: 2026-05-18  
Scope inspected: `services/api`, `apps/checkout-web`, `packages/sdk`, Prisma schema/migration, queue worker, gateway adapters, external test app.  
Verification status: source audit plus fresh build/run/preview verification completed.

## Fresh Verification Addendum

The missing build/run/preview pass was completed after resolving the local Node install path to `C:\myproject\TimePaceSage001234567\nvm\v20.19.5`.

Verified commands and results:

- `npm run build` from `Flowpay`: passed for `@flowpay/api`, `@flowpay/checkout-web`, and `@flowpay/sdk`.
- API preview started on `http://127.0.0.1:3011`.
- Checkout preview started on `http://localhost:3010`.
- External test app started on `http://127.0.0.1:3025`.
- Worker process started, but logged: `FlowPay worker started without Redis. Queue processing is disabled.`
- Health check returned `database: ok`, `redis: degraded`, overall `status: degraded`.
- Health check adapter modes: `CAMPAY: provider-sandbox`, `CINETPAY: internal-sandbox`, `MAVIANCE: internal-sandbox`.
- Original external `smoke.mjs` using `MTN_MOMO`/CamPay reached FlowPay but completed as `FAILED` through the CamPay provider-sandbox path.
- A controlled external smoke using `CARD_WALLET`/CinetPay internal sandbox completed successfully:
  - transaction: `cmpb6zlsr000hjhgs70x4vkw1`
  - initialize status: `PENDING`
  - selected provider: `CINETPAY`
  - confirmation status: `SUCCEEDED`
- Playwright browser preview tests passed:
  - successful hosted checkout iframe flow
  - failed payment display flow
  - result: `2 passed`

One local configuration change was made to complete the controlled external smoke: CinetPay was enabled for the active `New Test Org` organization used by `flowpay-external-test-app`. Its app access was already enabled; the organization-level flag was disabled.

Updated interpretation:

- The frontend checkout, external handoff, API initialization path, hosted checkout confirmation path, and browser iframe preview are functionally working in sandbox conditions.
- The production-readiness concerns remain valid because Redis was degraded, queue processing was disabled, CamPay provider-sandbox confirmation failed for the default smoke path, and the worker still does not perform real webhook dispatch or transaction retry business logic.

## Executive Verdict

FlowPay is a solid prototype-to-beta payment orchestration platform, but it is not yet fintech-production-ready for real money at scale. The strongest parts are the multi-tenant app model, hosted checkout path, provider abstraction, Prisma schema foundation, idempotency uniqueness on transaction creation, and audit/event tables. The most serious weaknesses are queue workers that do not actually retry payments or dispatch merchant webhooks, weak webhook verification for Maviance/CinetPay, non-atomic payment initialization around gateway calls, no reconciliation engine, no refund/chargeback/dispute lifecycle, no durable webhook delivery, and no concurrency-safe state-transition guard.

Recommended current readiness level: beta/internal sandbox only, or controlled small pilot with fake/sandbox money. Do not process real customer funds until the critical risks below are fixed.

Scores:

| Area | Score |
| --- | ---: |
| Overall architecture | 68/100 |
| Scalability | 45/100 |
| Security | 48/100 |
| Reliability | 42/100 |
| Fintech readiness | 35/100 |
| Async architecture | 30/100 |
| Webhook reliability | 38/100 |
| Queue system quality | 25/100 |
| Infrastructure maturity | 40/100 |

## 1. System Architecture Audit

Status: Strong  
Confidence: 70/100  
Risk level: Medium

Evidence:

- Workspace separation is clear: API, checkout web, and SDK are distinct packages.
- `services/api/src/app.ts` registers API modules behind `/api/v1`.
- Gateway provider abstraction exists through `GatewayAdapter`, `getGatewayAdapter`, and adapter files.
- Schema models Organizations, Apps, API keys, gateway config, attempts, transactions, settlements, webhook logs, retry jobs, and audit logs.
- External test app keeps FlowPay secret credentials server-side and calls `POST /api/v1/payments/initialize`.

Strengths:

- FlowPay is acting as an orchestration layer, not just a payment form.
- Provider selection is abstracted enough to support CamPay, Maviance, and CinetPay.
- Hosted checkout decouples external products from gateway-specific UX.
- Multi-tenant ownership is explicit through `organizationId` and `appId`.

Weaknesses:

- Provider abstraction is incomplete: Maviance and CinetPay adapters are skeleton-grade.
- Routing does not use provider priority or gateway health for failover.
- `packages/sdk` is only a small URL helper, not a production SDK.
- Internal service auth is a shared token, not a scoped service identity model.

Failure scenario:

If CamPay becomes unavailable, the system has no automatic provider failover despite seeded route strategy metadata. New payments will fail or remain processing.

Scalability impact:

The architecture can be scaled horizontally at the HTTP layer, but payment correctness is not currently protected enough for multi-instance concurrent production operation.

Production impact:

Good base architecture, incomplete production control plane.

Recommended fixes:

- Add a payment orchestration service with explicit state-machine transitions.
- Add provider routing policy based on app access, organization access, health, priority, currency, method, and amount.
- Make gateway adapter capabilities explicit.
- Expand SDK to initialize payments, open checkout, receive postMessage events, and validate integration errors.

## 2. Concurrency and Load Behavior Audit

Status: Critical Risk  
Confidence: 38/100  
Risk level: High

Evidence:

- `createTransaction` checks existing idempotency key before creating the transaction, then calls `prisma.transaction.create`.
- The uniqueness constraint `@@unique([appId, idempotencyKey])` is good, but the create path does not catch unique conflicts and re-fetch safely.
- Hosted checkout confirmation reads the transaction, checks status and attempts, calls the gateway, then writes a payment attempt and updates status inside a transaction.
- No row-level lock, compare-and-set update, version field, or serializable transaction protects duplicate checkout confirmations.

Possible failure scenario:

Two concurrent checkout confirmations for the same pending transaction can both read no recent processing attempt, both call the gateway, and both create `PaymentAttempt` rows. Depending on provider behavior, this can double-charge or create inconsistent gateway state.

Scalability impact:

The first bottlenecks will be DB connection count, synchronous gateway calls during request handling, and duplicate work under retries.

Estimated capacity:

- HTTP reads: likely hundreds of requests/minute on small infra.
- Payment initializations: limited by gateway latency and DB pool. Without queue-first capture, practical safe capacity is low.
- Concurrent real payment operations: unsafe above small pilot levels because duplicate capture and webhook race behavior are not hardened.

Recommended fixes:

- Use atomic state transitions: `UPDATE Transaction SET status='PROCESSING' WHERE id=? AND status IN ('PENDING','REQUIRES_ACTION')`.
- Only call gateway after successfully acquiring the transition.
- Add unique constraints on active gateway attempts, e.g. one capture attempt per transaction/provider/reference where applicable.
- Add load tests for initialize, checkout confirm, webhooks, and duplicate retries.
- Use DB transaction isolation or advisory locks for critical payment transitions.

## 3. Async Processing and Queue System Audit

Status: Critical Risk  
Confidence: 25/100  
Risk level: Critical

Evidence:

- Queues are declared in `services/api/src/lib/queues.ts`.
- Worker listens for `retry-queue` and `webhook-queue`.
- For `retry-transaction`, worker only creates a `RetryJob` with status `SUCCEEDED`; it does not query the provider, retry charge, update transaction, or schedule backoff.
- For `dispatch-app-webhook`, worker only records a retry job; it does not send an HTTP request to `App.webhookUrl`.
- Replay jobs are enqueued as `replay-webhook`, but the worker has no handler for `replay-webhook`.
- Redis fallback can disable queues entirely if Redis is unavailable.

Possible failure scenario:

A payment succeeds at the gateway and FlowPay queues an app webhook. The worker records a successful job but never calls the merchant webhook. The merchant never receives payment confirmation and cannot fulfill the order.

Scalability impact:

Queues do not currently absorb real production work. They provide a logging illusion, not reliable async execution.

Production impact:

This is the largest production-readiness gap.

Recommended fixes:

- Implement actual app webhook dispatch with signing, timeout, retry, exponential backoff, attempt logs, and dead-letter state.
- Implement gateway status reconciliation/retry jobs.
- Add BullMQ `attempts`, `backoff`, stalled job handling, job IDs for idempotency, DLQ, and queue metrics.
- Make Redis required in production; fail startup if Redis is unavailable.

## 4. Payment Flow Safety Audit

Status: Needs Improvement  
Confidence: 52/100  
Risk level: High

Evidence:

- Frontend does not directly mark payments successful; checkout confirmation calls API, which calls gateway adapter.
- `confirmHostedCheckout` returns existing successful transaction if already succeeded.
- Terminal webhooks are ignored if they conflict with existing terminal status.
- Settlement records are created during initialization, before payment success.

Weaknesses:

- The system marks sandbox capture success immediately.
- Settlement exists while transaction is still pending, with no lifecycle transition after success.
- No timeout/expiry job for abandoned checkout sessions.
- No cancellation flow.
- No provider verification query before final success for skeleton adapters.

Possible failure scenario:

A transaction remains `PROCESSING` forever because gateway callback never arrives and no reconciliation job checks provider truth.

Recommended fixes:

- Add explicit transaction state machine and allowed transition table.
- Add checkout expiration.
- Only make settlement eligible after authoritative success.
- Add provider verify/status APIs and reconciliation-based finalization.

## 5. Idempotency and Duplicate Protection Audit

Status: Acceptable for initialization, Critical Risk for processing  
Confidence: 45/100  
Risk level: High

Evidence:

- `Transaction` has `@@unique([appId, idempotencyKey])`.
- `createTransaction` returns an existing transaction for duplicate idempotency keys.
- Webhook dedupe is only status-based, not event-key based.
- `WebhookLog.requestId` exists but has no unique index.
- `PaymentAttempt.gatewayReference` has no unique constraint.

Possible double-processing scenario:

Provider sends the same successful webhook multiple times with different payload order or status aliases. FlowPay may create multiple logs and enqueue multiple merchant webhook notifications. If merchant webhook delivery were implemented without event IDs, the merchant could double-credit.

Recommended fixes:

- Store and enforce unique gateway event IDs/request IDs per provider.
- Add unique index on `(provider, requestId)` where requestId is not null.
- Add unique index on gateway references where provider reference is present.
- Add outgoing webhook event IDs and idempotency keys.
- Catch Prisma unique violations on transaction create and re-fetch.

## 6. Webhook Reliability Audit

Status: Critical Risk  
Confidence: 38/100  
Risk level: Critical

Evidence:

- Webhook route logs inbound payloads before processing.
- CamPay uses HMAC verification.
- Maviance and CinetPay verification only checks that a signature and secret exist.
- Webhook payload lookup uses provider reference, transaction ID, and external reference.
- Replay endpoint enqueues `replay-webhook`, but worker does not process it.

Possible failure scenario:

An attacker sends a forged Maviance webhook with any signature header while a Maviance secret exists. `verifyWebhookSignature` returns true, and the webhook can mark a transaction succeeded if references match.

Scalability impact:

Webhook handling is synchronous and DB-bound. Burst callbacks can contend on transaction rows and enqueue duplicate outbound webhooks.

Recommended fixes:

- Implement provider-specific signature verification for every provider.
- Use raw request body for signature verification, not re-stringified JSON.
- Add replay protection with timestamp tolerance and nonce/event ID uniqueness.
- Add webhook event status table with received, verified, processed, ignored, failed.
- Implement replay worker.

## 7. Database Audit

Status: Acceptable  
Confidence: 62/100  
Risk level: Medium

Evidence:

- Schema uses Decimal fields for money.
- Good baseline indexes exist for transaction lookup, org dashboard listing, selected provider status, settlement status, retry jobs, and audit logs.
- Important relations are explicit.

Weaknesses:

- No unique constraint on `PaymentAttempt.gatewayReference`.
- No unique webhook request/event constraint.
- No `updatedAt` on `PaymentAttempt`, no terminal event uniqueness.
- No ledger table with debit/credit entries.
- No balance/accounting model.
- No migration safety process beyond a single init migration.
- `listTransactions` takes latest 100 globally, not paginated or tenant-scoped.

Possible failure scenario:

Duplicate gateway references are inserted, making reconciliation ambiguous.

Recommended fixes:

- Add immutable ledger entries for money movement.
- Add indexes for `Transaction(status, createdAt)` and pending reconciliation scans.
- Add unique constraints for provider event IDs and gateway references.
- Add tenant-scoped pagination.
- Add migration review and rollback discipline.

## 8. Reconciliation System Audit

Status: Missing Completely  
Confidence: 15/100  
Risk level: Critical

Evidence:

- No provider status polling job exists.
- Retry queue worker does not call gateway status APIs.
- There is no scheduled job for stale `PROCESSING` or `PENDING` transactions.

Possible failure scenario:

Gateway successfully collects funds, but the webhook is lost. FlowPay and the merchant keep the payment as processing/pending forever.

Recommended fixes:

- Add reconciliation worker scanning stale processing payments.
- Implement provider `verify(reference)` in every adapter.
- Resolve truth using provider status, amount, currency, transaction ID, and app ownership.
- Add reconciliation reports and operator review states.

## 9. Security Audit

Status: Needs Improvement  
Confidence: 48/100  
Risk level: High

Evidence:

- App secret keys are hashed at rest.
- Public key plus secret key is required for payment initialization.
- Global rate limit exists.
- CORS allows all origins.
- Internal APIs use a shared static internal token.
- `hashSecret` uses plain SHA-256 without salt or slow KDF.
- `encryptPlaceholder` is base64 of key/value, not encryption.
- `.env` exists in local project; it was not disclosed in this audit.

Attack surfaces:

- Shared internal token compromise gives broad admin control.
- Weak provider signature validation allows webhook spoofing for Maviance/CinetPay.
- CORS `origin: true` is broad.
- No request body size controls were observed.
- No IP allowlist or mTLS for gateway/internal callbacks.
- No fraud/risk velocity rules.

Recommended fixes:

- Use HMAC or Argon2/bcrypt for API key hashes with prefix metadata.
- Add scoped internal auth/JWT with roles and audit actor identity.
- Restrict CORS in production.
- Add body size limits and strict content-type checks.
- Store secrets in a proper secret manager.
- Add fraud controls: velocity by app, phone, IP, amount, card/mobile money channel.

## 10. Observability and Monitoring Audit

Status: Needs Improvement  
Confidence: 45/100  
Risk level: Medium

Evidence:

- Fastify logger enabled.
- Health endpoint checks DB and Redis and shows adapter mode.
- Monitoring routes expose latest gateway health, webhooks, retries, settlements, and audit logs.
- AuditLog and TransactionEvent exist.

Weaknesses:

- No metrics endpoint.
- No tracing.
- No Sentry/OpenTelemetry integration.
- No queue depth metrics.
- No structured business metrics: success rate, failure rate, webhook latency, reconciliation gap.
- No alerting thresholds.

Recommended fixes:

- Add Prometheus/OpenTelemetry metrics.
- Add request correlation IDs and transaction trace IDs.
- Emit queue depth, job failure, webhook delivery, provider latency, and stale processing metrics.
- Add alerting for stuck processing transactions and webhook delivery failures.

## 11. Failure Recovery Audit

Status: Critical Risk  
Confidence: 35/100  
Risk level: Critical

Evidence:

- DB connect retries on startup.
- Redis connection failure can degrade to no queues.
- Gateway calls happen inside request flow.
- Retry worker does not recover payment truth.

Possible failure scenario:

FlowPay creates a transaction, calls the gateway, then crashes before recording the payment attempt or updating status. Gateway may have accepted the payment, but FlowPay has no reliable recovery path.

Recommended fixes:

- Use outbox pattern for gateway calls and webhooks.
- Persist attempt intent before external calls.
- Make Redis mandatory in production.
- Add reconciliation to recover after API/worker crashes.
- Add idempotent provider references.

## 12. External App Integration Audit

Status: Strong foundation, Needs Improvement for production  
Confidence: 60/100  
Risk level: Medium

Evidence:

- External test app stores credentials in `.env.local` and proxies initialize requests server-side.
- Smoke test initializes payment then confirms hosted checkout.
- Playwright tests cover success and failure hosted checkout flows.

Weaknesses:

- Test app webhook endpoint acknowledges but does not verify signature.
- No merchant webhook delivery exists from FlowPay worker.
- No contract tests for duplicate callbacks, retries, bad signatures, or stale payments.

Recommended fixes:

- Upgrade test app to verify FlowPay webhook signatures.
- Add E2E tests for app webhook delivery, duplicate webhooks, replay, and idempotency.
- Add test apps for Campus, AgroLink, and SmartSave with tenant isolation assertions.

## 13. Infrastructure and Deployment Audit

Status: Needs Improvement  
Confidence: 40/100  
Risk level: High

Evidence:

- API listens on `0.0.0.0`.
- Redis docker compose exists for local development.
- Worker is a separate script.
- No production Dockerfile, Fly config, process manager config, or CI was observed.

Weaknesses:

- Redis fallback is unsafe in production.
- No health/readiness separation.
- No graceful shutdown code for Fastify, Prisma, Redis, or workers.
- No horizontal scaling plan for workers.
- No deployment migration locking or release strategy.

Recommended fixes:

- Add production Dockerfiles and Fly.io config.
- Add separate `api` and `worker` process definitions.
- Add readiness probe requiring DB and Redis in production.
- Add graceful shutdown.
- Add CI build/test/migration checks.

## 14. Fintech Production Readiness Audit

Status: Critical Risk for real-money production  
Confidence: 35/100  
Risk level: Critical

Honest assessment:

FlowPay is beyond a toy project architecturally, but it is not yet a serious fintech-grade payment platform. It is best described as a promising beta/sandbox orchestration system with early admin observability and checkout foundations. It should not process real production money until queues, webhooks, reconciliation, state transitions, signature verification, and ledgering are redesigned.

Biggest hidden risks:

- Queue worker does not perform the business action its job names imply.
- Webhook verification is incomplete for two providers.
- Duplicate checkout confirmation can produce multiple gateway calls.
- No reconciliation means lost webhooks become permanent inconsistency.
- No ledger means settlement/accounting cannot be audited to fintech standards.

Biggest strengths:

- Clean modular API foundation.
- Multi-tenant app/organization model.
- Hosted checkout session path.
- Decimal money fields.
- Audit/event model foundation.

## 15. Top Findings

Top 10 strongest areas:

1. Clear workspace separation.
2. Multi-tenant organization/app model.
3. App credential model with public/secret/webhook keys.
4. Hosted checkout flow exists.
5. Idempotency key unique constraint for initialization.
6. Gateway adapter abstraction.
7. Prisma schema has useful baseline entities.
8. Transaction events and audit logs exist.
9. External test app validates backend credential handoff.
10. Health endpoint reports DB, Redis, and adapter mode.

Top 10 highest-risk areas:

1. Queue workers do not dispatch webhooks or retry transactions.
2. No reconciliation system.
3. Weak Maviance/CinetPay webhook verification.
4. Duplicate checkout confirmation race can trigger duplicate gateway calls.
5. No unique webhook event/request dedupe.
6. No ledger/accounting system.
7. Redis fallback disables critical async behavior.
8. Settlement is created before payment success.
9. Static shared internal token protects broad internal APIs.
10. No production deployment/CI/migration discipline visible.

Top 10 recommended improvements:

1. Implement a real transaction state machine with atomic transitions.
2. Implement real app webhook delivery with retries and DLQ.
3. Implement provider reconciliation workers.
4. Add provider-specific webhook signature verification using raw body.
5. Add unique event/request/gateway reference constraints.
6. Add immutable ledger and settlement lifecycle.
7. Make Redis mandatory in production.
8. Add provider verify/status APIs to adapters.
9. Add production observability and alerting.
10. Add CI, Docker/Fly config, and load/concurrency tests.

Top 5 dangerous failure scenarios:

1. Duplicate checkout confirmations cause duplicate gateway collections.
2. Gateway success webhook is lost and no reconciliation recovers it.
3. Forged Maviance/CinetPay webhook marks a transaction successful.
4. Merchant never receives a webhook because queue worker only logs.
5. API crashes after gateway charge but before local attempt/status persistence.

Top 5 impressive engineering decisions:

1. Multi-tenant schema separates apps and organizations early.
2. Hosted checkout token flow keeps merchant frontend away from secret keys.
3. Gateway abstraction is in place before provider sprawl.
4. AuditLog and TransactionEvent models exist from the start.
5. External integration test app exercises real credential handoff.

## What Happens With Thousands of Real-World Payment Operations?

Realistically, the API may accept some traffic, but payment correctness will degrade quickly. The strongest survival behavior is that idempotency keys prevent some duplicate initialization and the database schema can store many transaction records. The likely bottlenecks are synchronous gateway calls, DB pool saturation, Redis/queue fragility, and lack of worker business logic.

The most likely failure behavior is not a clean outage; it is inconsistent money state. Transactions will get stuck in `PROCESSING`, merchant systems will not receive reliable notifications, duplicate callbacks may create duplicate downstream events, and operators will lack reconciliation tools to determine gateway truth. Under real payment volume, this is more dangerous than simple downtime because it creates financial ambiguity.

Final production confidence: 35/100 for real fintech production, 65/100 for sandbox demos and controlled beta pilots.
