
# FLOWPAY ORCHESTRATION ENGINE — PRODUCTION ARCHITECTURE GOVERNING SPECIFICATION

## SYSTEM CONTEXT

FlowPay is a production-grade, non-custodial payment orchestration infrastructure layer powering the broader Flow ecosystem, including:
- FlowMoney
- Campus
- FlowShop
- external partner applications

FlowPay is NOT a bank.
FlowPay is NOT an escrow platform.
FlowPay is NOT a stored-value institution.

FlowPay is a high-performance orchestration engine responsible for:
- transaction routing,
- provider abstraction,
- settlement coordination,
- orchestration metering,
- infrastructure-level payment lifecycle management.

The system is designed for:
- high concurrency,
- regional telecom realities,
- multi-tenant orchestration,
- CEMAC operational constraints,
- and long-term production scalability.

---

# CORE ARCHITECTURAL PRINCIPLE

The platform enforces absolute separation of concerns.

## Client Applications
Client applications own:
- users,
- schools,
- sellers,
- marketplaces,
- subscriptions,
- internal business rules,
- tenant relationships.

Examples:
- Campus owns student ↔ school mapping.
- FlowShop owns buyer ↔ vendor mapping.

FlowPay NEVER manages these relationships.

---

# FLOWPAY RESPONSIBILITIES

FlowPay only understands:

1. Authenticated Client Applications
2. Destination Profiles
3. Payment Intents
4. Provider Routing Logic
5. Settlement Coordination
6. Infrastructure Usage Metering

FlowPay never interprets:
- “school”
- “student”
- “seller”
- “shop”
- “marketplace”

Those concepts belong entirely to the calling application.

---

# NON-CUSTODIAL ORCHESTRATION PRINCIPLE

FlowPay coordinates payment execution but does not economically own transaction funds.

The architecture is optimized to reduce:
- pass-through settlement exposure,
- unnecessary custody complexity,
- pooled third-party balances,
- and operational clearing liabilities.

Settlement execution must be delegated as much as possible to:
- telecom infrastructure,
- regulated aggregators,
- banking rails,
- and provider-native settlement systems.

---

# OPERATIONAL EXECUTION MODES

## MODE 1 — PLATFORM REVENUE MODE

### Purpose
Handles direct Flow ecosystem revenue.

### Examples
- SaaS subscriptions
- Flow premium upgrades
- orchestration package purchases
- infrastructure usage top-ups
- internal ecosystem billing

### Flow
User → Provider → Flow corporate settlement account

### Characteristics
- standard merchant collection
- direct corporate revenue
- isolated from tenant orchestration logic

Mode 1 remains fully operational and untouched.

---

# MODE 2 — MULTI-TENANT ORCHESTRATION MODE

## Purpose
Enable:
- student → school payments
- buyer → vendor transactions
- external platform routing
- tenant-directed settlement

without embedding tenant business logic into FlowPay.

---

# PAYLOAD-DRIVEN ROUTING

Client applications explicitly provide:
- external_recipient_id

FlowPay performs:
- token resolution,
- routing lookup,
- provider execution,
- settlement coordination.

FlowPay does NOT:
- determine school ownership,
- manage sellers,
- infer marketplace relationships.

---

# MODE 2 EXECUTION PIPELINES

The engine must support multiple settlement strategies depending on provider capabilities.

The external API schema remains stable regardless of internal routing strategy.

---

# MODEL A — TWO-STEP MIRROR EXECUTION

## Purpose
Support providers where dynamic direct settlement is not natively available.

Examples may include:
- CamPay
- Maviance
- CinetPay

## Workflow

### Step 1 — Collection
Provider collection endpoint is triggered.

### Step 2 — Settlement Validation
Webhook authenticity and settlement integrity checks are performed:
- cryptographic signature validation,
- replay protection,
- idempotency verification,
- transaction state reconciliation.

### Step 3 — Coordinated Payout
After successful validation:
- an asynchronous payout/disbursement workflow is triggered,
- funds are routed to the resolved destination profile.

### Step 4 — Audit Logging
The orchestration lifecycle is recorded using append-safe transaction audit logging.

---

# MODEL B — NATIVE SPLIT / SUBACCOUNT EXECUTION

## Purpose
Support providers with native marketplace settlement capabilities.

Examples:
- Flutterwave subaccounts
- provider-native split settlement APIs

## Workflow
FlowPay dynamically injects:
- subaccount identifiers,
- settlement configuration metadata,
- split parameters

into the provider request payload.

Provider infrastructure performs settlement distribution directly.

This minimizes:
- intermediary settlement exposure,
- routing complexity,
- payout coordination overhead.

---

# INFRASTRUCTURE USAGE METERING

FlowPay monetizes orchestration capacity and infrastructure execution.

It does NOT monetize custody of third-party funds.

---

# ENFORCED TERMINOLOGY RULES

The system must NEVER use:
- wallet
- virtual money
- stored value
- user balance

Use exclusively:
- orchestration_credits
- processing_units
- infrastructure_usage_balance
- orchestration_metering

across:
- code comments,
- schema definitions,
- internal exceptions,
- logs,
- dashboards,
- telemetry systems.

---

# ORCHESTRATION CREDIT ENGINE

Every successful orchestration lifecycle consumes:
- processing units,
- orchestration credits,
- or infrastructure metering allocations.

This applies to:
- Mode 1 collections
- Mode 2 orchestration executions
- payout coordination events
- settlement workflows

---

# CREDIT DEPLETION HANDLING

If infrastructure usage balance reaches zero:
- orchestration requests must be blocked,
- a structured error must be returned,
- no new execution pipelines may initialize.

This restriction applies at:
- application level,
- not tenant level.

FlowPay meters calling applications globally.

---

# DATABASE ARCHITECTURE

## CLIENT APPLICATIONS

Tracks:
- application identity,
- orchestration status,
- infrastructure usage balance,
- authentication metadata.

---

# DESTINATION PROFILES

FlowPay maintains routing abstractions only.

Recommended structure:

- external_recipient_id
- provider_type
- payout_target
- native_subaccount_id
- settlement_strategy
- provider_metadata
- verification_status
- supported_rails
- regional_currency
- routing_preferences

---

# PAYMENT INTENTS

Tracks:
- orchestration lifecycle,
- routing state,
- settlement coordination,
- webhook reconciliation,
- retry orchestration.

---

# APPEND-SAFE AUDIT LOGGING

The engine must maintain:
- traceable transaction history,
- provider payload records,
- webhook signatures,
- settlement states,
- payout coordination logs.

The objective is:
- operational observability,
- forensic debugging,
- compliance defensibility,
- reconciliation visibility.

---

# ROUTER ABSTRACTION LAYER

Implement a provider-agnostic routing interface.

Core engine execution flow:

1. Resolve external_recipient_id
2. Inspect provider capabilities
3. Determine settlement strategy
4. Dispatch to adapter execution layer

---

# REQUIRED ADAPTERS

## TwoStepMirrorAdapter
Coordinates:
- collection,
- settlement validation,
- payout orchestration,
- retry coordination.

---

## NativeSplitAdapter
Coordinates:
- provider-native split settlement,
- subaccount execution,
- marketplace routing metadata.

---

# IDEMPOTENCY REQUIREMENTS

Critical enforcement:
- payout execution must NEVER run twice,
- retries must remain deterministic,
- webhook replay attacks must be rejected.

Mandatory protections:
- idempotency locks,
- transaction hashes,
- replay prevention,
- state validation,
- request correlation IDs.

---

# WEBHOOK SECURITY REQUIREMENTS

All inbound provider callbacks must enforce:
- cryptographic signature validation,
- timestamp validation,
- payload hashing,
- anti-replay protections,
- strict provider verification.

No payout coordination may execute before validation succeeds.

---

# FAILURE RECOVERY STRATEGY

If:
- collection succeeds,
- but payout coordination fails,

the engine must immediately transition to:

COLLECTED_PENDING_PAYOUT

The system must then:
- trigger retry orchestration,
- generate alerting events,
- preserve reconciliation visibility,
- prevent orphaned settlement states.

Funds must never remain operationally invisible.

---

# OBSERVABILITY & TELEMETRY

The engine must support:
- structured tracing,
- correlation IDs,
- distributed logging,
- provider latency metrics,
- orchestration analytics,
- settlement lifecycle visibility.

---

# PERFORMANCE OBJECTIVES

The orchestration layer is optimized for:
- ultra-low latency execution,
- stateless compute scaling,
- high-concurrency event coordination,
- fault isolation,
- provider failover capability,
- resilient asynchronous processing.

---

# IMPLEMENTATION PHASE STRUCTURE

## PHASE 1 — CORE ORCHESTRATION FOUNDATION
Implement:
- Mode 1 stabilization
- Mode 2 ingestion
- recipient resolution
- router abstraction layer
- adapter dispatching
- provider capability inspection

---

## PHASE 2 — PROVIDER EXECUTION ADAPTERS
Implement:
- CamPay adapter
- Maviance adapter
- CinetPay adapter
- Flutterwave adapter
- webhook validation engine
- idempotency enforcement

---

## PHASE 3 — INFRASTRUCTURE METERING ENGINE
Implement:
- orchestration credit consumption
- infrastructure usage tracking
- depletion enforcement
- metering analytics

---

## PHASE 4 — RECOVERY & RESILIENCE SYSTEMS
Implement:
- retry queues
- payout recovery workflows
- dead-letter coordination
- settlement reconciliation states
- alert pipelines

---

## PHASE 5 — OBSERVABILITY & GOVERNANCE
Implement:
- audit dashboards
- tracing systems
- orchestration analytics
- operational telemetry
- compliance-grade logging
- forensic reconciliation tooling
- manual operational controls

FlowPay architechture is incomplete without flowPay admin operation integration in our flow admin app.

---

# FINAL ENGINEERING DIRECTIVE

Do not introduce unnecessary business abstractions.

Do not embed tenant logic inside FlowPay.

Do not hardcode marketplace assumptions.

Keep the engine:
- provider-agnostic,
- modular,
- highly concurrent,
- operationally observable,
- regionally adaptable,
- and optimized for long-term production infrastructure scaling.

FlowPay is infrastructure orchestration software — not a custodial financial institution.

### 📢 CRITICAL REFINEMENT: METERING ENGINE COUPLING

Apply the following strict architectural refinement regarding the FlowPay Orchestration Metering Engine:

1. MODE 2 ROUTING (Primary Coupling):
The Orchestration Metering Engine is the primary monetization mechanism for Mode 2 execution flows (Model A and Model B). Because FlowPay avoids real-time interception, custody, splitting, or retention of third-party transactional funds, infrastructure monetization must operate through a pre-paid virtual credit consumption model tied to orchestration activity and transactional volume.

2. MODE 1 COLLECTIONS (Hybrid/Flexible Coupling):
Mode 1 collections represent direct Flow-owned revenue flows landing within Flow corporate settlement infrastructure (e.g., SaaS subscriptions, infrastructure top-ups, premium modules, direct platform purchases, or configurable service billing).

Mode 1 execution remains hybrid and policy-configurable. These flows do not inherently require orchestration credit consumption unless explicitly enabled through application-level billing configuration, infrastructure metering policy, or usage-based monetization settings.

3. ENFORCEMENT MODEL:
The system architecture must treat Mode 2 orchestration as a metered infrastructure service by default, ensuring non-custodial monetization consistency across external tenant-routing scenarios.

Simultaneously, the architecture must preserve Mode 1 flexibility, allowing standard direct checkout execution, embedded pricing strategies, traditional provider fee handling, or optional infrastructure metering without mandatory virtual credit consumption.

4. ARCHITECTURAL PRINCIPLE:
The Orchestration Metering Engine is fundamentally a compliance-safe infrastructure monetization abstraction for non-custodial payment orchestration—not a universal requirement for all payment execution flows within the Flow ecosystem.

---

# FLOWPAY ORCHESTRATION - PROVIDER (REFINED PRODUCTION DIRECTIVE)

Ecosystem Architect

Ofe Caleb — Flow Ecosystem

System Domain

Multi-Provider Payment Orchestration

⸻

1. PROVIDER ORCHESTRATION MODEL

FlowPay must implement:

Open-Closed Capability-Based Provider Orchestration.

The system must NEVER tightly hardcode business logic to provider identity.

Instead:
providers expose dynamic capability matrices.

⸻

PROVIDER REGISTRY ENUM

enum ProviderType {
  CAMPAY,
  MAVIANCE,
  CINETPAY,
  FLUTTERWAVE,
  MONETBIL
}

⸻

PROVIDER CAPABILITY MODEL

Providers must register capabilities dynamically.

Example:

{
  "provider": "campay",
  "capabilities": [
    "LOCAL_MOMO_COLLECTION",
    "MTN_COLLECTION",
    "ORANGE_COLLECTION",
    "CAMEROON_ROUTING"
  ]
}

Example:

{
  "provider": "flutterwave",
  "capabilities": [
    "SUBACCOUNTS",
    "CARD_PAYMENTS",
    "BANK_RAILS",
    "PAN_AFRICAN_ROUTING"
  ]
}

⸻

2. PROVIDER FACTORY ARCHITECTURE

Execution pipeline:

Transaction Intent
↓
Capability Resolver
↓
Provider Selection Engine
↓
Provider Factory
↓
Provider Adapter
↓
Execution Layer
↓
Observability Layer
↓
Settlement Verification

⸻

3. PROVIDER STRATEGIC SPECIALIZATION

The routing engine may intelligently prioritize providers based on capability patterns.

Examples:

Campay

* Cameroon-local MoMo routing
* MTN collections
* Orange collections
* local merchant execution

Monetbil

* lightweight telecom collection fallback
* mobile-first execution
* low-friction secondary routing

Maviance

* banking rails
* GIMAC interoperability
* enterprise utility execution

CinetPay

* Francophone regional routing
* regional disbursement expansion

Flutterwave

* enterprise infrastructure
* subaccounts
* advanced payout systems
* pan-African scaling
* marketplace tooling

IMPORTANT:
These are strategic tendencies, NOT permanent architectural restrictions.

⸻

4. OBSERVABILITY & RESILIENCE LAYER

FloPay must implement enterprise-grade infrastructure observability.

⸻

Required Monitoring

* provider health scoring,
* latency monitoring,
* webhook verification,
* transaction confidence scoring,
* telecom degradation visibility,
* regional provider instability detection,
* settlement verification,
* infrastructure tracing,
* retry observability,
* execution analytics.

⸻

CIRCUIT BREAKER REQUIREMENTS

The orchestration engine must:

* isolate failing providers,
* degrade gracefully,
* prevent cascading failures,
* enforce retry safety,
* preserve idempotency guarantees.

⸻

FALLBACK EXECUTION POLICY

Fallback routing MUST be:

* capability-aware,
* idempotency-safe,
* policy-driven,
* transaction-state verified.

The engine must NEVER blindly retry failed collections without verifying:

* provider finality,
* transaction ambiguity state,
* duplicate debit risk,
* webhook reconciliation status.

⸻

# IMPLEMENTATION CONFORMANCE UPDATE - 2026-05-20

Implemented from this governing specification:

- Added application-level orchestration metering:
  - orchestration credits
  - processing units
  - infrastructure usage balance
  - append-safe metering ledger
- Added depletion enforcement before payment execution initializes.
- Added destination profiles keyed by `externalRecipientId` / `external_recipient_id`.
- Added Mode 2 multi-tenant routing without embedding tenant business logic.
- Added settlement strategy support:
  - `TWO_STEP_MIRROR`
  - `NATIVE_SPLIT`
- Added payout coordination records with deterministic idempotency keys.
- Added `COLLECTED_PENDING_PAYOUT` settlement state for two-step mirror execution.
- Added provider-agnostic router service.
- Added internal destination profile management endpoints.
- Removed prohibited stored-value terminology from active runtime payment surfaces.

Validation completed:

- Prisma migration applied successfully.
- Prisma client generated successfully.
- API build passed.
- Checkout build passed.
- API health: database ok, Redis ok.
- Queue monitoring: no waiting, active, or delayed jobs.
- External hosted checkout Playwright suite: `2 passed`.
- Mode 2 routing smoke:
  - resolved `external_recipient_id`
  - selected destination profile
  - persisted `MULTI_TENANT`
  - persisted `TWO_STEP_MIRROR`
  - stored routing-only destination snapshot
  - consumed one metering unit
- Depletion enforcement smoke returned HTTP `400` for a zero-metering application before execution initialized.

## ADDITIONAL CONFORMANCE UPDATE - 2026-05-20

Implemented after the metering/provider refinement:

- Added explicit app-level metering policy:
  - `mode1MeteringEnabled` defaults to `false`.
  - `mode2MeteringEnabled` defaults to `true`.
- Updated transaction initialization so Mode 2 routing remains metered by default, while Mode 1 direct platform collections are only metered when the app policy explicitly enables it.
- Expanded the provider registry to:
  - `CAMPAY`
  - `MAVIANCE`
  - `CINETPAY`
  - `FLUTTERWAVE`
  - `MONETBIL`
- Added provider capability registry and merged runtime capability metadata.
- Added provider capability checks for destination-profile routing, including native-split capability validation.
- Added provider health scoring metadata for admin/control-plane use.
- Updated gateway adapter factory to support future providers through safe sandbox fallback until real adapters are configured.
- Updated app, organization, provider, destination-profile, webhook, transaction, reconciliation, and health code paths to use the provider enum instead of three-provider string unions.
- Updated Flow Admin FlowPay management surface:
  - provider lists include Monetbil and Flutterwave
  - provider controls expose capability matrix and health score
  - application configuration exposes Mode 1 and Mode 2 metering policy
  - application cards expose infrastructure usage balance, processing units, and orchestration credits

Validation completed:

- Prisma schema format passed.
- Prisma schema validation passed.
- Prisma client generation passed.
- FlowPay API build passed.
- FlowPay checkout build passed.
- FlowPay SDK build passed.
- Flow Admin backend typecheck/build passed.
- Flow Admin frontend typecheck/build passed.

Deployment validation:

- The new Prisma migrations were applied successfully:
  - `20260520043000_gateway_provider_registry`
  - `20260520043100_metering_policy_provider_defaults`
- Prisma migration status confirmed: database schema is up to date.

Runtime connectivity note:

- After migration deployment, the workstation/network again became intermittently unable to reach Neon/Upstash.
- API startup now uses bounded DB connection attempts with per-attempt timeout.
- Redis queue creation now respects startup Redis availability and disables queue producers/workers cleanly in development fallback instead of creating noisy DNS retry loops.
- Full live checkout/API/worker smoke should resume once Neon and Upstash are reachable again from the workstation.

## PHASE 2 HARDENING UPDATE - 2026-05-20

Additional production-hardening controls now implemented:

- Provider health/circuit status is enforced before new payment traffic is accepted.
- A provider marked disabled, `offline`, or `down` is isolated from both direct initialization and hosted checkout confirmation.
- Degraded providers are surfaced operationally without unsafe blind replay or automatic debit retry.
- Gateway webhook replay protection now works even when the provider omits a stable event ID.
- Synthetic replay keys are generated from provider, callback reference, callback status, signature, and payload hash.
- Replayed invalid webhooks preserve their rejected response instead of being acknowledged as successful duplicates.
- The documented `packages/sdk` workspace has been restored with a typed FlowPay client foundation.

Validation:

- Prisma schema validation passed.
- FlowPay monorepo build passed.
- Flow Admin backend build passed.
- Flow Admin frontend build passed.
- Local API startup under Neon/Upstash outage conditions showed bounded DB retry and clean Redis queue fallback behavior.

Current external dependency note:

- Neon and Upstash TCP connectivity from the workstation is currently failing.
- Live payment, queue, worker, checkout, admin runtime, and Playwright smoke testing should be rerun as soon as managed-service connectivity is restored.

## POST-RESTART RUNTIME UPDATE - 2026-05-20

Runtime validation resumed after workstation restart:

- Neon TCP connectivity succeeded.
- Upstash Redis TCP connectivity succeeded.
- Prisma migration status confirmed the database schema is up to date.
- FlowPay API, FlowPay worker, checkout web, external test app, Flow Admin API, and Flow Admin frontend started successfully.
- API health reported database and Redis OK.

Additional production hardening completed:

- Flow Admin control-plane aggregation exposed a read-path Prisma timeout in the FlowPay `/apps` and `/organizations` internal endpoints.
- The issue was caused by default provider/capability repair logic using long interactive transactions during read requests.
- The repair logic now uses idempotent bulk `createMany(..., skipDuplicates: true)` operations instead of long read-path transactions.
- This preserves the same self-healing defaults while keeping Flow Admin read surfaces responsive under managed Postgres latency.

Validation:

- FlowPay monorepo build passed.
- External CamPay hosted-checkout smoke succeeded.
- External app Playwright suite passed with `2 passed`.
- Flow Admin control-plane endpoint returned `transactions=121`, `apps=14`, `providers=5`.
- Flow Admin browser smoke confirmed operations/provider pages load and show CamPay, Flutterwave, and Monetbil.
- Queue monitoring returned no waiting, active, or delayed jobs.
