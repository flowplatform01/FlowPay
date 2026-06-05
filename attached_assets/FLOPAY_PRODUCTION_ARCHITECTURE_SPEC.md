
# FLOPAY ORCHESTRATION ENGINE — PRODUCTION ARCHITECTURE GOVERNING SPECIFICATION

## SYSTEM CONTEXT

FloPay is a production-grade, non-custodial payment orchestration infrastructure layer powering the broader Flow ecosystem, including:
- FlowMoney
- Campus
- FlowShop
- external partner applications

FloPay is NOT a bank.
FloPay is NOT an escrow platform.
FloPay is NOT a stored-value institution.

FloPay is a high-performance orchestration engine responsible for:
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

FloPay NEVER manages these relationships.

---

# FLOPAY RESPONSIBILITIES

FloPay only understands:

1. Authenticated Client Applications
2. Destination Profiles
3. Payment Intents
4. Provider Routing Logic
5. Settlement Coordination
6. Infrastructure Usage Metering

FloPay never interprets:
- “school”
- “student”
- “seller”
- “shop”
- “marketplace”

Those concepts belong entirely to the calling application.

---

# NON-CUSTODIAL ORCHESTRATION PRINCIPLE

FloPay coordinates payment execution but does not economically own transaction funds.

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

without embedding tenant business logic into FloPay.

---

# PAYLOAD-DRIVEN ROUTING

Client applications explicitly provide:
- external_recipient_id

FloPay performs:
- token resolution,
- routing lookup,
- provider execution,
- settlement coordination.

FloPay does NOT:
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
- Campay
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
FloPay dynamically injects:
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

FloPay monetizes orchestration capacity and infrastructure execution.

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

FloPay meters calling applications globally.

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

FloPay maintains routing abstractions only.

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
- Campay adapter
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

---

# FINAL ENGINEERING DIRECTIVE

Do not introduce unnecessary business abstractions.

Do not embed tenant logic inside FloPay.

Do not hardcode marketplace assumptions.

Keep the engine:
- provider-agnostic,
- modular,
- highly concurrent,
- operationally observable,
- regionally adaptable,
- and optimized for long-term production infrastructure scaling.

FloPay is infrastructure orchestration software — not a custodial financial institution.

Additionally, do not isolate FloPay strictly as a backend orchestration engine. As you know FloPay also includes a centralized operational management layer integrated into the broader Flow Admin platform. The implementation process must therefore continuously account for the FloPay administrative interface and governance tooling alongside backend infrastructure development.

The Flow Admin integration is considered a first-class operational component of FloPay and must evolve in parallel with the orchestration engine itself.

This includes, but is not limited to:

transaction monitoring,
orchestration analytics,
provider management,
routing controls,
webhook observability,
payout coordination visibility,
infrastructure usage metering dashboards,
reconciliation tooling,
audit visibility,
retry/recovery management,
operational alerting,
and platform governance controls.

Do not architect the backend in isolation from the administrative experience if and only if it also nessesary need upgrade. Backend orchestration capabilities must expose clean, scalable, and observable management interfaces suitable for enterprise-grade operations inside the Flow Admin ecosystem.