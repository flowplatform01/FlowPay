# FlowPay Production Hardening Report

Date: 2026-05-18

## Final Production Completion Addendum

This final pass focused on correctness at payment finality boundaries, async worker behavior, Flow Admin stability, and realistic end-to-end validation.

Completed:

- Added settlement finalization as a shared transaction-side effect:
  - `SUCCEEDED` transactions settle pending/processing settlement rows to `SETTLED`.
  - `FAILED`, `CANCELLED`, and `EXPIRED` transactions fail pending/processing settlement rows.
  - checkout, gateway webhook processing, and reconciliation now use the same settlement finalization path.
- Added CamPay provider status lookup support for reconciliation using the configured CamPay adapter.
- Reconciliation now prefers authoritative provider lookup when a gateway reference exists, and marks transactions `UNDER_REVIEW` on provider amount/currency mismatch.
- Added database hardening migration:
  - partial unique index for non-null `PaymentAttempt.gatewayReference`
  - partial unique index for non-null `(WebhookLog.provider, WebhookLog.requestId)`
  - transaction status/createdAt index
  - settlement transaction/status index
- Added Prisma-visible indexes for gateway reference, webhook request ID, settlement state, and transaction status queries.
- Hardened inbound gateway webhooks:
  - duplicate request IDs dedupe before reprocessing
  - invalid signatures are rejected without mutating transactions
  - provider-mismatch webhooks are blocked from mutating transactions owned by another provider
- Added API production error mapping:
  - database connectivity errors now return `503 Service Unavailable`
  - uniqueness conflicts now return `409 Conflict`
  - payment initialization and checkout confirmation no longer convert transient database failures into business `400` responses
- Fixed Flow Admin fallback-session consistency:
  - fallback admin login, `/admin/me`, and `/admin/access` now agree when Neon has transient availability issues
  - FlowPay admin smoke was updated for the current UI headings and retryable transient backend states
- Restarted the worker and verified it drains Redis-backed webhook jobs.

Final deep validation:

- API health: `ok`
- Redis health: `ok`
- Database health: `ok` during final checks, with intermittent Neon connectivity blips observed and now surfaced as retryable service failures.
- Deep live validation script: passed
  - parallel hosted checkout confirmations both returned `SUCCEEDED`
  - final payment attempts count remained `1`
  - settlement finalized to `SETTLED`
  - merchant app webhook delivered through the worker with HTTP 200
  - invalid CamPay webhook signature returned 401 and did not mutate the transaction
  - signed CamPay webhook updated the transaction to `SUCCEEDED`
  - duplicate CamPay webhook request ID was deduplicated
  - CamPay webhook against a CinetPay-owned transaction was blocked
  - queue monitoring endpoint returned live queue counts
- Final deep validation transaction IDs:
  - checkout/concurrency: `cmpbgzn21000fjhuw5ankxptm`
  - signed CamPay webhook: `cmpbgzvgh000tjhuww154tqay`
- External browser E2E: `2 passed`
- Flow Admin FlowPay UI smoke: `FLOWPAY_UI_SMOKE_OK`
- FlowPay workspace build: passed
- Flow Admin workspace build: passed

Operational note:

- Historical failed queue jobs remain from earlier pre-fix runs:
  - retry queue failed jobs: `4`
  - webhook queue failed jobs: `8`
- Current queue state after final validation had no waiting or active jobs. The failed historical jobs should be reviewed or archived through operations before real production launch.

## Redis and Env Finalization Addendum

The Redis blocker was investigated and resolved.

Findings:

- `services/api/.env` had an active remote `REDIS_URL` and a commented local Redis fallback.
- The API used `dotenv.config()` without an explicit path, so workspace starts depended on the current working directory and could load root `Flowpay/.env` while ignoring `services/api/.env`.
- The active Redis URL was remote/non-local, and the previous Redis client did not force TLS for Upstash-style hosts.

Changes made:

- `services/api/src/config/env.ts` now loads env files explicitly:
  - root `Flowpay/.env`
  - then `Flowpay/services/api/.env` as an API-specific override
- `services/api/src/config/redis.ts` now enables TLS automatically for:
  - `rediss://` URLs
  - Upstash hosts
- BullMQ-compatible Redis option `maxRetriesPerRequest: null` is now used.
- Root and service `.env.example` files now document clear separation:
  - root `.env` is the canonical workspace runtime env
  - `services/api/.env` is an API-specific override
  - local Redis uses `redis://localhost:6379`
  - Upstash/managed Redis uses `rediss://...`
  - operational fallback/TLS flags are not part of the normal env surface
- Follow-up cleanup removed `REDIS_TLS` and `ALLOW_REDIS_FALLBACK` from the public env example surface and runtime schema.
- Runtime behavior is now internal:
  - Redis TLS is inferred from `rediss://` and Upstash hostnames.
  - Redis fallback is allowed only outside production.
  - Production fails fast if Redis is unavailable.

Redis verification:

- API startup log: `Redis Connected and ready`
- Worker startup log: `Redis Connected and ready`
- Health endpoint: `status: ok`, `database: ok`, `redis: ok`

## Flow Admin Finalization Addendum

Flow Admin was inspected, built, previewed, and connected to the live FlowPay control plane.

Completed:

- Inspected Flow Admin backend proxy module:
  - `backend/src/modules/flowpay/flowpay.service.ts`
  - `backend/src/modules/flowpay/flowpay.controller.ts`
  - `backend/src/modules/flowpay/flowpay.routes.ts`
- Inspected Flow Admin frontend FlowPay module:
  - overview
  - operations
  - applications
  - organizations
  - providers
  - billing
  - developer
  - audit
  - settings
- Added FlowPay queue monitoring into the Flow Admin control-plane response.
- Added FlowPay queue types to the frontend contract.
- Updated the FlowPay Settings page with:
  - CamPay primary route panel
  - Redis-backed async worker posture
  - retry queue and webhook queue counts
- Ordered providers with CamPay first so the configured primary provider is treated as the operational default.
- Updated the Flow Admin UI smoke script to clear stale auth state and use robust login/page expectations.

CamPay positioning:

- CamPay is treated as the configured primary operational route.
- Maviance and CinetPay remain future-ready provider adapters and admin-control entities, but are not treated as current launch blockers while their env credentials are absent.

Flow Admin verification:

- Flow Admin backend started on `http://localhost:5001`.
- Flow Admin frontend started on `http://localhost:5173`.
- Flow Admin login API verified with seeded admin credentials.
- `npm run build` in `flow-admin`: passed for backend and frontend.
- Flow Admin FlowPay UI smoke: `FLOWPAY_UI_SMOKE_OK`.
- Smoke covered:
  - `/flowpay/overview`
  - `/flowpay/applications`
  - `/flowpay/organizations`
  - `/flowpay/providers`
  - `/flowpay/billing`
  - `/flowpay/audit`
  - `/flowpay/settings`
  - desktop overflow checks
  - mobile audit page overflow check
  - screenshots under `flow-admin/.logs/playwright/`

## Completed Hardening

### Queue Infrastructure

- Added BullMQ default job options for retries, exponential backoff, and failed/completed job retention.
- Replaced placeholder worker behavior with real handlers:
  - `retry-transaction` now runs reconciliation logic.
  - `dis patch-app-webhook` now sends merchant webhooks.
  - `replay-webhook` now reprocesses stored gateway webhook logs.
- Added deterministic BullMQ job IDs for transaction retry and webhook dispatch to reduce duplicate queue work.
- Added internal queue monitoring endpoint:
  - `GET /api/v1/internal/monitoring/queues`

### Merchant Webhook Dispatch

- Added `app-webhook.service.ts`.
- Sends signed merchant webhook payloads to `App.webhookUrl`.
- Adds event ID/type headers:
  - `x-flowpay-event-id`
  - `x-flowpay-event-type`
  - `x-flowpay-signature`
- Uses timeout-controlled HTTP delivery.
- Records delivery outcomes in `RetryJob` for operator visibility.

### Reconciliation

- Added `reconciliation.service.ts`.
- Reconciliation now checks authoritative provider status when the adapter supports it, then falls back to latest payment-attempt inference:
  - `SUCCESS` attempt -> `SUCCEEDED`
  - `FAILED` attempt -> `FAILED`
  - raw provider status aliases -> inferred final state
- Reconciliation emits transaction events and queues merchant webhook notifications after state repair.
- Non-authoritative cases are recorded as failed reconciliation attempts rather than blindly recharging.
- Provider amount/currency mismatch moves the transaction to `UNDER_REVIEW`.

### Checkout Concurrency Safety

- Hardened `confirmHostedCheckout`.
- Confirmation now atomically acquires eligible transactions by moving them from `PENDING`/`REQUIRES_ACTION` to `PROCESSING` before calling the gateway.
- Duplicate confirmations now return the in-flight/final transaction instead of causing duplicate gateway capture attempts.
- Gateway exceptions now mark the transaction failed with a transaction event.

### Idempotency Safety

- `createTransaction` now catches Prisma unique-key races on `(appId, idempotencyKey)` and re-fetches the existing transaction.
- This protects concurrent duplicate initialization requests from surfacing avoidable errors.

### Gateway Webhook Dedupe

- Inbound gateway webhooks now capture request/event IDs when available.
- Previously seen webhook IDs are deduplicated before creating new processing work.
- Gateway-triggered merchant webhook queue jobs now use deterministic job IDs.
- Provider-mismatch webhooks are blocked from mutating unrelated provider transactions.

### Settlement Finality

- Settlement rows now follow terminal transaction state consistently.
- Checkout success and signed gateway webhook success settle pending settlement rows.
- Checkout/gateway failure fails pending settlement rows.
- Reconciliation repairs settlement state when it repairs transaction state.

### Database Constraints

- Applied migration `20260518170000_hardening_constraints`.
- Enforces unique non-null gateway references.
- Enforces unique non-null provider webhook request IDs.
- Adds indexes for status, settlement, and monitoring workloads.

### Production Redis Behavior

- Redis fallback remains available for development.
- In `NODE_ENV=production`, Redis connection failure now fails startup instead of silently disabling async processing.

## Verification Results

Build:

- `npm run build`: passed
- API TypeScript build: passed
- Checkout Next.js build: passed
- SDK TypeScript build: passed
- Final FlowPay workspace build: passed.
- Final Flow Admin workspace build: passed.

Preview:

- API started on `http://127.0.0.1:3011`
- Checkout started on `http://localhost:3010`
- External test app started on `http://127.0.0.1:3025`

Health:

- Database: `ok`
- Redis: `ok`
- Overall health: `ok`
- Queue monitoring returned live BullMQ counts for `retryQueue` and `webhookQueue`.

Functional smoke:

- Controlled external test app payment through `CARD_WALLET` / CinetPay internal sandbox succeeded.
- Transaction: `cmpbdkvl50001jha4drk1h35t`
- Final status: `SUCCEEDED`
- Redis-backed queue smoke also succeeded.
- Transaction: `cmpbe3yqh0001jh6c38xqgljl`
- Worker result: app webhook delivered with HTTP 200.
- Payment attempts: `1`.
- Final deep validation:
  - checkout/concurrency transaction `cmpbgzn21000fjhuw5ankxptm`
  - status `SUCCEEDED`
  - payment attempts `1`
  - settlement `SETTLED`
  - app webhook delivered with HTTP 200
  - signed CamPay webhook transaction `cmpbgzvgh000tjhuww154tqay`
  - duplicate signed CamPay webhook deduplicated
  - provider-mismatch webhook blocked

Browser E2E:

- `npm run test:e2e` in `flowpay-external-test-app`: passed
- Result: `2 passed`
- Covered successful hosted checkout iframe flow and failed payment display flow.
- Re-run after Redis fix: `2 passed`.
- Final external checkout E2E after env cleanup and Flow Admin work: `2 passed`.
- Final external checkout E2E after production hardening: `2 passed`.
- Final external checkout E2E after Upstash Redis correction: `2 passed`.

## Redis Production-Style Runtime Correction

The temporary Upstash Redis endpoint is now treated as a production-level async dependency while still keeping operational behavior out of `.env`.

Completed:

- Restored both runtime env files to the provided Upstash `redis://...` URL form.
- Kept TLS handling internal to the application; Upstash hostnames are detected and connected with TLS automatically.
- Removed operational Redis flags from real env files:
  - `ALLOW_REDIS_FALLBACK`
  - `REDIS_TLS`
- Updated `services/api/src/config/redis.ts` with `enableReadyCheck: false` so ioredis does not fail on provider-specific readiness behavior.
- Restarted API and worker after the Redis correction.

Verification:

- API log: `Redis Connected and ready`
- Worker log: `Redis Connected and ready`
- Health endpoint: `status: ok`, `database: ok`, `redis: ok`
- External app CARD_WALLET initialization succeeded after the correction.
- External app browser E2E after the correction: `2 passed`.

Admin E2E:

- Flow Admin FlowPay UI smoke: `FLOWPAY_UI_SMOKE_OK`.
- Covered overview, applications, organizations, providers, billing, audit, settings, desktop overflow, mobile audit overflow, and screenshot capture.

## Real CamPay Sandbox Flow

A real CamPay sandbox payment flow was executed through the external test app using Playwright as the browser driver.

CamPay sandbox test input:

- Payment method: `MTN_MOMO`
- Phone number: `237677777777`
- Amount: `10 XAF`
- Expected CamPay behavior: MTN pending to successful

Issues found and fixed during the test:

- XAF gateway amount was being sent as a decimal after fee calculation. CamPay requires whole-number XAF amounts.
  - Fixed zero-decimal currency rounding in `services/api/src/modules/fees/fees.service.ts`.
- Node global `fetch` could reach CamPay token sometimes but timed out on CamPay collect through Cloudflare.
  - Added IPv4-first DNS setup in `services/api/src/config/network.ts`.
  - Switched the CamPay adapter to built-in HTTPS requests for token, collect, and status calls.
- CamPay sandbox status returned `SUCCESSFUL` with `amount: "0.00"` for the fake test-number transaction.
  - Treated zero provider amount as non-authoritative for CamPay reconciliation while preserving the raw payload.
- Reconciliation finalized the transaction but left the original payment attempt as `PENDING`.
  - Fixed reconciliation to update the latest payment attempt to `SUCCESS` or `FAILED` when it finalizes the transaction.

Verified result:

- External app created checkout session through FlowPay.
- Playwright opened the hosted checkout and clicked `Authorize 13 XAF`.
- FlowPay sent the payment to CamPay and received a real provider reference.
- CamPay provider reference: `fbb3c9cf-7178-4e57-8b06-865cd8ad7d64`
- FlowPay transaction: `cmpbog5sx0001jh74mug96v98`
- Final transaction status: `SUCCEEDED`
- Payment attempt status: `SUCCESS`
- Settlement status: `SETTLED`
- Queue state after processing: no waiting, active, or delayed jobs.

Concurrency check:

- Created one checkout session.
- Submitted two confirmation requests in parallel.
- Both callers received `SUCCEEDED`.
- Final transaction status: `SUCCEEDED`.
- Payment attempts created: `1`.
- Capture events created: `1`.
- Transaction: `cmpbdnj0n0017jha4ogo5h7gp`

## Remaining Production Work


## Current Readiness Update

FlowPay is materially safer after this pass. Duplicate checkout confirmation is guarded, queue workers execute real behavior, merchant webhook dispatch is verified through Redis/BullMQ, gateway webhook dedupe is enforced at code and database levels, settlement state follows terminal payment state, and reconciliation has a conservative provider-aware implementation.
These are still required before real-money launch:

1. Add authoritative status-query APIs for Maviance and CinetPay when their real credentials and provider contracts are available.
2. Store app webhook signing secrets in a recoverable encrypted form or introduce asymmetric webhook signatures.
3. Implement full ledger/accounting tables for double-entry financial auditability.
4. Add provider-specific signature verification for Maviance and CinetPay beyond placeholder checks.
5. Add CI that runs build, API tests, Playwright tests, and migration checks.
6. Add production deployment config, graceful shutdown, and readiness probes.
7. Add metrics/alerts for queue depth, webhook failures, stuck processing transactions, provider latency, and reconciliation failures.
8. Drain, archive, or annotate historical failed queue jobs from earlier pre-fix runs.
9. Execute a real CamPay mobile-money roundtrip with real provider callback delivery in the target production/staging environment.

Current realistic readiness:

- Sandbox/demo: strong
- Controlled beta: strong, with operational monitoring and historical queue cleanup
- Real-money production: close, but still requires double-entry ledgering, production deployment probes/alerts, real CamPay callback roundtrip validation, and final provider-specific work for Maviance/CinetPay when those credentials are introduced

## Final Checkout UX And Retry Polish

Final polish completed after the CamPay flow exposed a merchant-facing UX gap:

- Hosted checkout now posts explicit terminal events to the parent app:
  - `flowpay:checkout-status`
  - `flowpay:checkout-completed`
  - `flowpay:checkout-failed`
- The external test app bottom sheet now reacts to terminal events and shows a clear success or failure state instead of staying in the initial payment authorization view.
- The external app result panel is updated with `checkoutStatus` after terminal checkout completion.
- Checkout polling now follows the real asynchronous provider window and stops on terminal status.
- The parent bottom sheet includes a bounded pending notice for unusually slow provider confirmation.
- The external test app red debug page background was removed and replaced with a production-suitable neutral background.

Retry/reconciliation correction:

- CamPay `PENDING` provider status is now treated as retryable queue work instead of a completed one-shot reconciliation.
- Retry behavior remains bounded and failure-driven:
  - no retry loop when Redis is already connected
  - no retry loop when DB is healthy
  - provider reconciliation retries only after an authorized transaction remains non-terminal
  - BullMQ retry attempts are bounded

Validation completed:

- API build: passed.
- Checkout build: passed.
- External app Playwright suite: `2 passed`.
- API health after clean restart: `status: ok`, `database: ok`, `redis: ok`, CamPay in `provider-sandbox`.
- Real CamPay API smoke: `FLOWPAY_EXTERNAL_TEST_APP_OK cmpbrg0z8000tjhgg9zip1xnu SUCCEEDED`.
- Real CamPay Playwright UI smoke: `FLOWPAY_REAL_UI_OK cmpbrjz750017jhggeakmbihz`.

Runtime cleanup:

- Removed stale duplicate local FlowPay API/worker processes from previous restart attempts.
- Restarted a single fresh API, worker, and checkout instance for validation.
- Reconciled the pre-fix CamPay smoke transaction left in `PROCESSING`: `cmpbr4obx0017jh1kcnuk5857` -> `SUCCEEDED`.

## Real-Number Confirmation Incident Fix

Observed issue:

- During a real-number CamPay phone confirmation, the checkout confirmation request returned `503`.
- API health recovered immediately afterward and reported DB/Redis `ok`.
- The affected transaction was not terminal failed; it remained `PROCESSING`.
- The checkout UI incorrectly displayed `Payment Failed` with `Database is temporarily unavailable`.

Corrective changes:

- Checkout API client now preserves HTTP status/code details from failed checkout API calls.
- Checkout UI classifies transient `5xx`/Prisma connectivity errors as verification interruptions, not payment failures.
- A processing checkout now continues bounded background polling after a transient refresh/confirmation failure.
- The UI now displays a “still verifying” state for temporary infrastructure interruptions.
- Backend checkout confirmation now retries the critical post-provider database persistence step on transient Prisma connectivity/pool errors.
- External test app stylesheet cache was bumped so the production background replaces the old red debug background.

Validation after correction:

- API build: passed.
- Checkout build: passed.
- External app Playwright suite: `2 passed`.
- API health: `status: ok`, `database: ok`, `redis: ok`.

Manual review note:

- The live incident transaction `cmpbrqof6001zjhggn5gvi8d0` remained `PROCESSING` with no local payment attempt/provider reference because the transient DB failure happened before the provider reference was persisted.
- CamPay sandbox status lookup by FlowPay transaction id returned HTTP `400`, so the provider status cannot be safely inferred locally for that orphaned transaction.
- This transaction should be manually checked in the CamPay dashboard before marking it terminal.

## Confirmed Real-Number Stuck Processing Fix

Observed issue:

- Real-number CamPay payment `cmpbs7gaz000tjhl09b2171ra` was confirmed on phone but stayed on the checkout waiting screen.
- The transaction had a stored CamPay provider reference and a pending payment attempt, but no retry job was attached.
- The worker therefore had no queued reconciliation task to move it from `PROCESSING` to terminal state.

Corrective changes:

- Worker now runs a bounded recovery sweep for stuck `PROCESSING` transactions with pending provider references.
- The sweep reconciles missed queue jobs without retrying healthy DB/Redis connections or looping over unrelated transactions.
- Checkout polling window was extended to cover real mobile-money confirmation latency.
- External test app static assets now include `Cache-Control: no-store, max-age=0` to avoid stale debug CSS.

Validation:

- Real transaction `cmpbs7gaz000tjhl09b2171ra` reconciled to `SUCCEEDED`.
- Latest payment attempt status: `SUCCESS`.
- Settlement status: `SETTLED`.
- API health: `status: ok`, `database: ok`, `redis: ok`.
- API build: passed.
- Checkout build: passed.
- External app Playwright suite: `2 passed`.

## Saved-Recipient Physical Test Correction

Observed issue:

- During physical testing of `Saved Recipient Transfer`, the external app returned a setup error.
- The merchant-facing test app was sending saved recipient ID `panama-mode2-recipient`.
- The database only had an older generated recipient profile for the same app: `panama-mode2-20260523020948`.
- The browser result also exposed internal wording: `Destination profile was not found for external_recipient_id`.

Corrective changes:

- Added the stable verified saved-recipient profile expected by the external app:
  - saved recipient ID: `panama-mode2-recipient`
  - display context: `Panama Stores Wallet`
  - payout target: `+237677777777`
  - provider rail: `MAVIANCE`
  - verification status: `VERIFIED`
- Sanitized missing-recipient browser errors in the external app:
  - public result now says the saved recipient was not found or is not ready for payouts.
  - internal `DestinationProfile` / `external_recipient_id` wording is not shown to merchant users.

Validation:

- Saved Recipient Transfer initialization succeeded with amount `12 XAF`.
- Public checkout session showed:
  - recipient: `Panama Stores Wallet`
  - account: `+237677777777`
  - description: `Wallet transfer to saved recipient`
  - no public operator context.
- Saved Recipient Transfer confirmation completed with `SUCCEEDED`.
- External test app server syntax check passed.
- External app Playwright checkout suite passed: `2 passed`.

## Recipient Profile Admin and Provisioning Hardening

Observed gap:

- School/saved-recipient setup existed in FlowPay core, but operators had to use raw internal API calls to create destination profiles.
- External apps also had no controlled app-facing recipient provisioning path; allowing this blindly would be unsafe.

Corrective changes:

- Flow Admin Applications now includes a Recipients workspace for each app.
- Operators can create, review, verify, and suspend destination profiles directly from Flow Admin.
- Application configuration now has recipient-provisioning controls:
  - allow/deny app-created recipient profiles
  - auto-verification toggle
  - per-app recipient profile limit
- FlowPay API now supports app-authenticated recipient provisioning at `/api/v1/destination-profiles`.
- App-created recipients are blocked unless Flow Admin explicitly enables provisioning for that app.
- App-created recipients are also blocked when the app has no positive profile limit.
- New app-created recipients default to `PENDING` unless auto-verification is explicitly enabled.
- Provider access is enforced before recipient creation, so apps cannot create recipients for disabled rails.
- Audit logs now record app-created recipient provisioning events.

Validation:

- FlowPay Prisma migration applied successfully:
  - `20260529090000_destination_profile_provisioning_controls`
- Prisma client generation passed.
- FlowPay production build passed.
- Flow Admin backend and frontend production build passed.

Runtime validation note:

- A live API smoke test could not complete after the build because the Neon database host became temporarily unreachable during API startup.
- The migration had already applied successfully before the connectivity drop.

Follow-up hardening:

- App-facing recipient provisioning policy failures now return explicit 4xx responses instead of generic server errors.
- Disabled provisioning, disabled provider access, inactive apps, missing limits, and exhausted limits are now reported as controlled policy failures.
- External test app saved-recipient setup messages now avoid leaking internal destination-profile terminology for provisioning-disabled and limit-exhausted cases.

Latest validation:

- FlowPay production build passed after the provisioning error-handling correction.
- Flow Admin production build passed with the recipient-management workspace and app-level provisioning controls.
- External test app server syntax check passed.
- Checkout web is running locally on port `3010`.
- External test app is running locally on port `3025`.

Current runtime blocker:

- FlowPay API port `3011` and Flow Admin backend port `5001` are not running because both configured Neon Postgres hosts are unreachable from this machine on TCP `5432`.
- This blocks live API/admin smoke testing until database connectivity returns.

## Customer Payment-Rail Abstraction Correction

Observed issue:

- The External Test App exposed infrastructure connector names such as CamPay, Maviance, CinetPay, and Monetbil in merchant/customer-facing setup.
- Checkout inspect support could expose backend routing/provider context through a public checkout URL.
- This leaked FlowPay orchestration details into surfaces that should only talk in real payment rails.

Corrective changes:

- External Test App saved-recipient setup now exposes `Payout Method` only:
  - MTN Mobile Money
  - Orange Money
  - Bank Transfer
- External Test App checkout setup now sends only customer-recognizable payment methods.
- The merchant backend maps those payment rails to internal FlowPay provider connectors privately.
- External Test App request/result summaries no longer expose internal provider connector fields.
- Checkout public session serialization no longer supports operator/provider context output.
- `inspect=1` no longer causes provider/orchestration internals to appear in checkout session responses.

Redis operational hardening added during restart validation:

- After the machine restart, Neon DB connectivity recovered, but Upstash returned `ERR max requests limit exceeded`.
- Redis quota exhaustion now opens a short-lived Redis circuit so health checks, queue monitoring, and enqueue paths stop repeatedly touching Redis.
- Queue enqueue paths now fail softly after database state is persisted and record local retry/failure state instead of throwing user-facing payment failures.
- Queue monitoring now reports `Redis circuit is open` without polling Redis again while the circuit is active.

Validation:

- FlowPay production build passed after the abstraction and Redis circuit-breaker corrections.
- FlowPay API is running on port `3011`.
- Checkout web is running on port `3010`.
- External Test App is running on port `3025`.
- Flow Admin backend is running on port `5001`.
- Flow Admin frontend is running on port `5173`.
- FlowPay health:
  - database: `ok`
  - redis: `degraded` because temporary Upstash quota is exhausted
- Served External Test App HTML contains no CamPay, Maviance, CinetPay, Monetbil, or Flutterwave customer-facing labels.
- Served External Test App JS contains no customer-facing provider connector labels or `operatorContext`.
- Merchant initialization smoke succeeded with customer-facing `MTN Mobile Money`.
- Checkout session smoke returned only public payment methods and did not expose provider/orchestration internals, even with `inspect=1`.

## Implementation Continuity Review - 2026-06-02

Purpose:

- Re-verified the previous hardening phase after the Redis/Upstash interruption, machine restart, and IDE restart.
- Confirmed the project state from actual code, builds, runtime services, and targeted smoke tests before moving into the AZERT performance phase.

Verified complete:

- FlowPay production build passed for API, checkout web, and SDK.
- FlowPay API restarted cleanly on port `3011` with database `ok` and Redis `ok` after escalated external network access.
- FlowPay worker started with Redis queue processing enabled.
- Checkout web remained available on port `3010`.
- External Test App remained available on port `3025`.
- Flow Admin backend restarted cleanly on port `5001`.
- Flow Admin frontend remained available on port `5173`.
- Flow Admin `/flowpay/control-plane` returned live FlowPay data after FlowPay API was restarted cleanly.

Corrections made during continuity review:

- Checkout status polling now has a guarded reconciliation probe for stale `PROCESSING` checkout sessions with provider references.
- Worker DB sweeps now run even when Redis queues are unavailable, so stuck transaction reconciliation, providerless review, and payout coordination are not accidentally disabled by Redis degradation.
- External smoke retries 429 rate-limit responses instead of failing immediately during repeated local validation.
- External Playwright output directories are configurable to avoid local file-lock/permission failures.
- Flow Admin UI smoke can write screenshots to a configurable directory and no longer depends on a stale Playwright browser revision.
- Flow Admin DB retry handling recognizes stale Neon `P1017` / closed connection cases.

Validation results:

- External Test App smoke completed successfully:
  - `FLOWPAY_EXTERNAL_TEST_APP_OK cmpwl4mxf0001jhws7fd3vqm6 SUCCEEDED`
- External Playwright checkout suite passed:
  - successful hosted checkout flow
  - failed payment flow
  - `2 passed`
- Flow Admin focused diagnostics confirmed:
  - login succeeds with current seeded credentials
  - FlowPay control-plane API returns live data
  - FlowPay Applications page renders `Application Onboarding and Access`
  - measured Applications page render latency: approximately `11.3s` in local cold/heavy control-plane conditions

Remaining caveat:

- The full `flowpay-ui-smoke.mjs` runner is still flaky under repeated local Playwright runs because browser launch/page timing and heavy control-plane loads can exceed fixed timeouts.
- This is a test-runner reliability issue, not a confirmed FlowPay payment lifecycle failure.
- The next AZERT phase should treat Flow Admin control-plane latency and large payload rendering as a performance optimization target.

Transition decision:

- Previous implementation phase is functionally complete enough to transition.
- Do not rebuild completed architecture.
- Continue into AZERT performance, latency, realtime, webhook, and production-experience optimization from this verified foundation.

## AZERT Performance Phase - Initial Corrections

Observed bottleneck:

- Flow Admin's FlowPay control-plane page was intermittently slow because every page load could fan out from the Admin backend to many FlowPay internal endpoints.
- In local/dev React conditions, duplicate frontend requests could trigger duplicate heavy aggregation work.
- This created slow perceived rendering on the Applications tab and made full browser smoke validation flaky under repeated runs.

Correction:

- Added short-lived Flow Admin backend caching for the FlowPay snapshot and built control-plane response.
- Added in-flight request coalescing so concurrent requests share one aggregation instead of duplicating the full fan-out.
- Added automatic cache invalidation after non-GET FlowPay admin mutations, so operator actions still refresh the control-plane state.
- Kept the cache TTL intentionally short (`10s`) to improve responsiveness without hiding operational changes for long periods.

Measured result:

- Flow Admin control-plane cold API call after restart: approximately `5820ms`.
- Flow Admin control-plane warm API call after cache hit: approximately `445ms`.
- Flow Admin Applications tab measured render after cache warm-up: approximately `7871ms`.

Validation:

- Flow Admin backend build passed.
- Flow Admin frontend build passed.
- FlowPay API health remained `ok` with database `ok` and Redis `ok`.
- Flow Admin control-plane endpoint returned live metrics:
  - applications: `14`
  - transactions: `199`

Remaining performance targets for AZERT:

- Reduce cold Flow Admin control-plane payload size and render cost.
- Consider endpoint scoping per tab so Applications, Operations, Billing, and Audit do not always require the same full control-plane payload.
- Continue measuring checkout initialization, provider capture, reconciliation, queue processing, and UI status propagation before making further latency changes.

## AZERT Core FlowPay Checkout Pass

Scope correction:

- AZERT's primary target is the FlowPay payment experience itself: merchant initialization, hosted checkout, payment confirmation, provider reconciliation, and final UI synchronization.
- Flow Admin remains an operational/control-plane surface. It is useful for visibility and governance, but FlowPay checkout must remain independently functional and production-grade without depending on the Admin app.

Corrections:

- Reused the authenticated app profile loaded by the app-auth guard during transaction initialization instead of querying the same application/profile/policy data again inside `createTransaction`.
- Tightened active checkout status reconciliation so a customer waiting in checkout gets the first guarded provider-status probe sooner:
  - first eligible checkout poll reconciliation: `8s`
  - per-transaction reconciliation throttle: `15s`
- Updated the External Test App merchant backend retry policy:
  - retries FlowPay `429` rate-limit/backpressure responses
  - uses bounded exponential backoff with jitter instead of fixed retry delays

Measured result:

- Baseline merchant initialize before auth-profile reuse: approximately `7661ms`.
- Post-correction initialize: approximately `4063ms` internal measured API lifecycle on transaction `cmpwuflen0001jhc0v3s9a266`.
- Post-correction checkout confirmation completed and terminal state propagated:
  - `FLOWPAY_EXTERNAL_TEST_APP_OK cmpwuflen0001jhc0v3s9a266 SUCCEEDED`
  - CamPay provider reference persisted: `b0f13d4b-7d15-4936-a3f4-415afc87bcb2`
  - provider status reconciled to `SUCCEEDED` from authoritative CamPay status
- External Test App browser integration passed after the checkout/retry corrections:
  - successful hosted checkout flow
  - failed payment flow
  - `2 passed`
- Runtime stack active after validation:
  - FlowPay API: `3011`
  - FlowPay checkout: `3010`
  - External Test App: `3025`
  - FlowPay worker: active

Remaining core latency observations:

- Remote database round trips still dominate initialization and confirmation:
  - routing dependency load, transaction record persistence, metering consumption, checkout lock acquisition, and capture-result persistence are the largest measured DB-side segments.
- Provider confirmation remains asynchronous by design. Checkout should not pretend this is instant; it should keep the customer informed, poll/reconcile intelligently, and stop immediately when terminal status arrives.
- Further optimization should reduce database round trips and payload size in the core transaction/checkout path before touching unrelated Admin UI surfaces.

## Physical Checkout Test Corrections - 2026-06-03

Observed from physical browser/phone testing:

- `Online Store Order` and `Subscription Invoice` could move to `UNDER_REVIEW` after phone confirmation even when the customer completed the CamPay prompt.
- The affected CamPay transactions showed FlowPay gross amounts that matched CamPay `app_amount`, while CamPay `amount` represented a larger customer/provider-side amount.
- FlowPay reconciliation was comparing against CamPay `amount`, so valid confirmed payments could be conservatively flagged as provider amount mismatch.
- `Saved Recipient Transfer` using a newly created `my-real-test` recipient failed even though the profile existed and was verified.
- The recipient failure was caused by a customer-facing/generic rail value `MOBILE_MONEY` being checked directly against provider capability names.
- `Declined Payment Test` could accidentally become a real MTN/CamPay collection if the tester changed the payment method after selecting the failure scenario.

Corrections:

- CamPay status reconciliation now treats `app_amount` as the authoritative FlowPay-side amount when it is present, falling back to `amount` only when needed.
- Destination-profile rail validation now maps customer-facing/generic rails to provider capability names:
  - `MOBILE_MONEY` / `MOMO` -> `LOCAL_MOMO_COLLECTION`
  - `MTN_MOMO` / `MTN_MOBILE_MONEY` -> `MTN_COLLECTION`
  - `ORANGE_MONEY` -> `ORANGE_COLLECTION`
  - `CARD` / `CARD_PAYMENT` -> `CARD_PAYMENTS`
  - `BANK_TRANSFER` -> `BANK_RAILS`
- External Test App now locks the payment method for `Declined Payment Test` so it remains a controlled card/sandbox failure scenario and cannot prompt a real MTN phone confirmation.

Validation:

- FlowPay API build passed after the CamPay and rail-capability corrections.
- FlowPay API restarted with database `ok` and Redis `ok`.
- Verified `my-real-test` saved-recipient initialization through the External Test App:
  - transaction `cmpxmys830001jht8fxvrpj7h`
  - provider `CAMPAY`
  - orchestration mode `MULTI_TENANT`
  - settlement strategy `TWO_STEP_MIRROR`
  - external recipient `my-real-test`
- Verified `Declined Payment Test` locks to `Card` even when `MTN_MOMO` is submitted:
  - transaction `cmpxnec4r000yjht8lg8d62y1`
  - provider `CINETPAY`
  - no CamPay/MTN route
- External Test App smoke passed after corrections:
  - `FLOWPAY_EXTERNAL_TEST_APP_OK cmpxnf6zd0019jht8hsotnclg SUCCEEDED`
- External Test App browser checkout suite passed after corrections:
  - successful hosted checkout flow
  - failed payment flow
  - `2 passed`

Operator note:

- Historical transactions already moved to `UNDER_REVIEW` remain review records and should not be silently rewritten without an operator action trail.
- New CamPay confirmations should use the corrected `app_amount` comparison and avoid this false review state.

## Payment Review State-Machine Correction - 2026-06-04

Observed from live phone testing:

- Real CamPay transactions could still move to `UNDER_REVIEW` too aggressively.
- One transaction had a provider `FAILED` status with reason `LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED`, but FlowPay marked it as review because amount mismatch was evaluated before terminal provider status.
- Another transaction later proved successful, but it remained stuck in `UNDER_REVIEW` until an operator/manual recheck.
- Manual retry created retry jobs, but Redis/Upstash instability meant the worker did not always process those jobs promptly.

Corrections:

- Reconciliation now evaluates provider terminal status before amount-mismatch review escalation.
- Amount/currency mismatch can move a payment to `UNDER_REVIEW` only after the provider reports authoritative `SUCCESS`.
- Provider `FAILED` now reconciles to `FAILED` instead of review, even if provider amount fields differ.
- Internal manual retry now performs an immediate reconciliation attempt with `forceReviewRecheck` while still creating the retry job/audit trail as fallback.
- Worker retry processing also honors manual `UNDER_REVIEW` rechecks.

Validation:

- Immediate audited recheck corrected the two affected physical-test transactions:
  - `cmpxv977f0033jht8o8mte4y7` -> `FAILED`
  - `cmpxvd8zr003pjht8tujaje7f` -> `SUCCEEDED`
- FlowPay API build passed after the state-machine and manual-retry corrections.
- FlowPay API restarted with database `ok` and Redis `ok`.
- External Test App smoke passed after the correction:
  - `FLOWPAY_EXTERNAL_TEST_APP_OK cmpz7bw59000jjhqkt197yhpq SUCCEEDED`
- External Test App browser checkout suite passed after the correction:
  - successful hosted checkout flow
  - failed payment flow
  - `2 passed`

Operational note:

- Upstash/Redis and Neon showed intermittent `ETIMEDOUT`, `ECONNRESET`, and transient reachability errors during validation.
- The payment lifecycle must therefore keep critical reconciliation recoverable through database-backed/manual paths, not only through Redis queue processing.

## CamPay Mode 2 Payout Execution Correction - 2026-06-04

Observed from physical Mode 2 testing:

- A `Custom Merchant Payment` using saved recipient `my-real-test` collected successfully through CamPay.
- The transaction reached `SUCCEEDED` and `COLLECTED_PENDING_PAYOUT`, but the payout coordination failed with:
  - `CAMPAY adapter does not support payout execution; operator payout action is required`
- The CamPay dashboard had API withdrawal enabled, but FlowPay's CamPay adapter was only implementing collection/status calls.

Correction:

- FlowPay's CamPay gateway adapter now implements provider payout execution through CamPay withdrawal.
- Existing payout coordination validation remains intact:
  - transaction must be `SUCCEEDED`
  - transaction must be Mode 2 / `MULTI_TENANT`
  - settlement strategy must be `TWO_STEP_MIRROR`
  - destination profile must be verified
  - destination profile must have a payout target
- A guarded internal payout-coordination processing endpoint was added so failed payout records can be intentionally retried after an adapter/configuration correction, with an audit trail instead of silent mutation.

Validation:

- FlowPay API TypeScript build passed after the CamPay payout adapter and internal payout-process endpoint changes.
- FlowPay API restarted and returned health `ok` with:
  - database `ok`
  - Redis `ok`
- FlowPay worker restarted and reported:
  - Redis connected
  - queue processing enabled
- Existing historical payout record for transaction `cmpz7kkv6002djhqkjwvb524t` remains failed until intentionally reprocessed; it was not retried automatically to avoid silently initiating a real-money withdrawal.

Operator note:

- Enabling withdrawals in CamPay authorizes the provider account, but FlowPay must still implement and call the provider withdrawal endpoint. That adapter gap is now closed.
- Retrying the historical `my-real-test` payout will call a real CamPay withdrawal to the saved recipient payout target and should only be done intentionally.

## AZERT Real-Time Architecture Review Closure - 2026-06-04

Decision:

- FlowPay checkout needs one-way payment status updates from FlowPay to the hosted checkout.
- Full WebSockets are unnecessary for this use case and would add operational complexity without clear value.
- Server-Sent Events are the right production-grade fit, with the existing polling path retained as fallback.

Implemented:

- Added a token-protected checkout status stream:
  - `GET /api/v1/checkout/session/:id/events?token=...`
- The stream sends the current serialized checkout session immediately.
- While a transaction is processing, the stream refreshes DB-backed checkout state and can trigger the existing guarded reconciliation probe.
- The stream sends keepalive comments and closes after terminal checkout state:
  - `SUCCEEDED`
  - `FAILED`
  - `CANCELLED`
  - `EXPIRED`
  - `UNDER_REVIEW`
- Invalid checkout tokens are rejected with `401`.
- Checkout Web now subscribes with `EventSource`.
- Existing polling remains as fallback when the browser cannot keep the SSE stream open.
- External Test App integration remains unchanged: terminal status still propagates from checkout iframe to merchant page through `postMessage`.

Validation:

- FlowPay API build passed.
- FlowPay checkout production build passed.
- FlowPay API restarted on `3011` with:
  - database `ok`
  - Redis `ok`
- FlowPay worker restarted and queue processing is enabled.
- FlowPay checkout restarted on `3010`.
- SSE route validation passed against a real hosted checkout transaction:
  - transaction `cmpzk3eh6000fjh9k7f5vwh15`
  - stream emitted `event: status`
  - payload status `SUCCEEDED`
  - invalid token check returned `401`

## Credit Automation and Billing-Aligned Metering Closure - 2026-06-05

Scope:

- Reviewed the Cursor-delivered credit purchase, recipient confirmation, and merchant self-service changes against `brief.md`, `line.md`, and `chatgpt talk.md`.
- Corrected credit consumption away from arbitrary operation charges and toward billable economic cost.

Implemented / corrected:

- Credit purchase intents are now tied to the purchasing application and finalizing transaction:
  - transaction must belong to the same app
  - transaction reference must match the purchase intent
  - transaction amount must match the intended credit purchase amount
  - already-completed purchase intents are idempotent only for the same transaction
- Credit purchase finalization is wired from checkout completion, gateway webhook completion, direct transaction completion, and reconciliation completion.
- Payout coordination no longer consumes a second arbitrary credit after payout success.
- Transaction metering now uses configured billing components:
  - FlowPay platform fee
  - provider collection fee
  - provider payout/disbursement fee only for Mode 2 two-step settlement
- Zero-fee transactions can remain zero-credit transactions instead of falling back to a default one-unit charge.
- Flow Admin Provider Routing now exposes separate controls for:
  - collection fixed fee
  - collection percentage fee
  - payout fixed fee
  - payout percentage fee
- FlowPay provider configuration API now accepts and persists payout fee metadata used by Mode 2 credit metering.

Validation:

- FlowPay API source type check passed with `tsc --noEmit`.
- FlowPay Checkout source type check passed with `tsc --noEmit`.
- Flow Admin frontend source type check passed with `tsc --noEmit`.
- Flow Admin backend source type check passed with `tsc --noEmit`.
- External Test App restarted and served `/api/config` successfully.

Runtime caveat:

- Full FlowPay API runtime validation could not be completed in this pass because the configured Neon database became unreachable from the active session (`P1001: Can't reach database server`). Redis fallback behavior was observed, but payment/credit runtime endpoints require database availability.
- Build commands that write into existing `dist` folders hit Windows `EPERM` locks from active local processes, so non-emitting TypeScript checks were used for validation without killing unrelated user processes.
