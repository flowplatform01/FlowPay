📌 PROMPT FOR OPUS 4.7 — FLOWPAY REAL-WORLD SYSTEM AUDIT + LIVE EXECUTION VALIDATION

You are acting as a senior systems auditor + production reliability engineer with deep expertise in distributed payment systems, multi-provider orchestration, and real-world transactional infrastructure.

You are given access to a production-grade system called FlowPay, which is a multi-provider payment orchestration engine integrated into a real external test application used for live transaction simulation.

⸻

🎯 OBJECTIVE

Perform a deep architectural audit and operational validation of the FlowPay orchestration engine and its supporting infrastructure following its recent major foundation upgrade.

This is NOT a theoretical review or a bug-hunting exercise for transient UI glitches.

This is a:
- **Production reliability audit**: Can the system handle high-stakes financial traffic in real-life scenarios?
- **Orchestration integrity check**: Does the Mode 1/Mode 2 logic maintain strict isolation and correct routing?
- **Post-upgrade validation**: Identify "outdated" components, workers, or interfaces that were not fully synchronized with the new foundation.
- **Operational gap analysis**: Are the management tools (Admin App) sufficient for production-grade maintenance?

⸻

🧠 CONTEXT

FlowPay is a non-custodial payment orchestration layer designed to:
- Route payments via multiple providers (CamPay, Monetbil, Maviance, CinetPay).
- Enable multi-tenant routing (Mode 2) where funds are directed to an `external_recipient_reference`.
- Monetize via an infrastructure credit/metering engine.

The system has recently undergone a major foundation upgrade. While the core "Engine" (Database and API) has been updated, there is a high probability that the **Execution Layers**, **Background Workers**, and **Management Interfaces** are now **outdated** or incomplete relative to the new architectural specifications.

⸻

🧪 TASK REQUIREMENTS

You MUST perform the following:

⸻

1. ORCHESTRATION & ROUTING INTEGRITY AUDIT

Reconstruct the full transaction lifecycle for both Mode 1 and Mode 2:
External App → FlowPay → Provider → Webhook → [Settlement/Payout] → Destination

Identify if the system handles "Real-Life Scenarios" correctly:
- What happens if a tenant provides an invalid recipient reference?
- Does the system prevent "Accidental Mode 1 Fallbacks" through strict policy enforcement?
- Verify the handoff between the API and the background workers.

⸻

2. OPERATIONAL GAP & "OUTDATED" COMPONENT ANALYSIS

Analyze the system for components that have become "outdated" or disconnected following the upgrade:
- **Admin App**: Can an Admin actually manage infrastructure credits and monitor Mode 2 payouts, or is there "Admin Blindness"?
- **Checkout Web**: Is the checkout UI **outdated** ?
- **Background Workers**: Does the worker process actually execute the payout coordination logic, or is it currently a "Ghost Process"?
- **Provider Adapters**: Verify if secondary providers (Maviance, CinetPay) are production-ready or merely "Skeleton Adapters."

⸻

3. SYSTEM ROBUSTNESS & FRAGILITY AUDIT

Simulate how the system handles "messy" real-world conditions:
- **Sanitization**: Does the system fix user formatting errors (e.g., phone number prefixes) or does it fail "fragilely"?
- **Deadlocks**: Audit the reconciliation sweep logic for potential race conditions or infinite retry loops.
- **Credit Enforcement**: Does the system gracefully handle balance depletion?

⸻

4. SYSTEM RESPONSIBILITY MATRIX

For each identified gap or failure scenario, clearly define responsibility:
- App responsibility
- FlowPay API responsibility
- Worker/Infrastructure responsibility
- Provider responsibility
- External app/infrastructure responsibility

⸻

5. FINAL DIAGNOSTIC REPORT

Produce a structured final report containing:
- **Primary Architectural Gaps**: Identified missing executioners or outdated management tools.
- **Production Risk Level**: How close is the system to being "Production Ready"?
- **Outdated Components**: List of files or services requiring immediate synchronization with the foundation.
- **Strategic Fix Recommendations**: Prioritized roadmap to bridge the "Foundation vs. Execution" gap.

⸻

🚨 IMPORTANT RULES

- Do NOT focus on simple formatting or UI bugs.
- Treat FlowPay as a high-concurrency financial platform, not an MVP.
- Prioritize **Visibility** and **Execution** over theoretical design.
- Use strict system engineering logic to identify "Stuck" or "Orphaned" transaction states.

⸻

🎯 FINAL OUTPUT

Deliver a full production-grade diagnostic report explaining the current "Synchronization Gap" between the new foundation and the operational environment, with evidence-based reasoning.

---

## Execution Update - 2026-05-23

This audit has been converted from report-only review into direct hardening work.

Completed hardening:

- Mode 2 recipient alias safety is fixed.
  - `external_recipient_reference` now maps into the strict destination-profile resolver.
  - Invalid recipient references fail payment initialization instead of falling back into Mode 1.
- Transaction phone normalization is now handled inside FlowPay before provider handoff.
- Mode 2 payout coordination is no longer a ghost record.
  - A payout execution service now processes due coordination jobs.
  - The worker runs the payout coordination sweep.
  - Retry behavior is conditional and does not repeatedly process terminal failures.
- Gateway adapters now have an explicit payout execution contract.
  - Internal sandbox providers support payout execution for lifecycle validation.
  - Unsupported real-provider payout adapters surface operator-action-required failures.
- Flow Admin Operations now exposes payout coordination status, attempts, recipient references, masked payout targets, and failure reasons.
- Flow Admin incidents now include payout coordination failures/pending work.
- Flow Admin browser smoke coverage now includes `/flowpay/operations`.

Evidence from live validation:

- FlowPay monorepo build passed.
- Flow Admin backend and frontend builds passed.
- Prisma migration status confirmed the production database schema is up to date.
- FlowPay API health returned `status: ok`, `database: ok`, `redis: ok`.
- Worker started with Redis queue processing enabled.
- External test app smoke passed with a succeeded transaction.
- External checkout Playwright suite passed both success and failure paths.
- Flow Admin browser smoke passed with Operations page included.
- Focused Mode 2 smoke passed:
  - invalid recipient reference rejected.
  - valid `external_recipient_reference` routed to `MULTI_TENANT`.
  - provider selected as `MAVIANCE`.
  - phone normalized to `+237677777777`.
  - payout coordination reached `SUCCEEDED` after one attempt.

Remaining production responsibility:

- CamPay pay-in is operational and remains the primary configured provider.
- Maviance and CinetPay are architecture-ready but still require real provider payout credentials and final real-provider payout adapter execution before they can be called fully production-complete.
- FlowPay now makes this gap visible operationally instead of allowing silent pending payout states.

