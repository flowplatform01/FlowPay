We are now at the final production-hardening stage of FlowPay. This is NOT a request to redesign the architecture or rebuild existing systems. Everything already exists and is working. Your task is to inspect, refine, verify, and harden the implementation so FlowPay is truly production-ready.

### 1. Refine the Gateway Environment Strategy

We have successfully integrated Fapshi.

As u know The following environment variables already exist and are correctly configured:

- FAPSHI_LIVE_API_KEY
- FAPSHI_LIVE_API_USER
- FAPSHI_SANDBOX_API_KEY
- FAPSHI_SANDBOX_API_USER
- FAPSHI_WEBHOOK_SECRET
- all required webhook configuration
- sandbox and live endpoints

inspect the current implementation.

Currently, the mindset appears to be:

- Development → always use Fapshi Sandbox
- Production → always use Fapshi Live

That is not flexible enough.

As you know FlowPay already has its own internal concept of Sandbox and Live environments.

Refine the gateway selection so that the chosen credentials depend on FlowPay's own active environment on it rather than simply the application's build mode.

Meaning:

- If the application… in FlowPay is currently operating… in Sandbox mode, use the Sandbox credentials.
- If the application… in FlowPay is currently operating…  in Live mode, use the Live credentials.

This should work regardless of whether the server itself is running in development or production.

Also verify that the Admin application can switch app or depending on the concept sanbox/live is to/for  between Sandbox and Live .

The gateway adapters should automatically respect that selection.

---

### 2. Verify the Fee Engine

Inspect the Fee Breakdown implementation.

I noticed an entry labelled "Gateway Fee."

Verify that this does NOT represent money belonging to Fapshi, CamPay, Flutterwave, Monetbil, CinetPay, or any external provider.

FlowPay already supports flexible pricing:

- percentage fees
- flat fees
- gateway-specific pricing
- app-specific pricing

The "Gateway Fee" inside FlowPay should simply represent FlowPay's configurable pricing policy for that gateway (money billed is still owned by FlowPay)

External providers charge FlowPay separately through their own billing systems.

As u know Those charges must never become part of FlowPay's internal fee accounting.

Inspect the implementation and confirm this separation.

If necessary, rename or clarify the terminology so future developers cannot misunderstand it.

---

### 3. Inspect Pending Transactions

I noticed several current/historical transactions still remain in the Pending state.

Investigate every possible reason.

Examples:

- gateway disconnected
- webhook never received
- sandbox interruption
- manual cancellation
- timeout
- abandoned payment
- payout failure

Determine whether these transactions are behaving correctly.

If appropriate, migrate stale historical Pending transactions into a more accurate terminal state such as:

- Under Review
- Expired
- Failed
- Cancelled

Do not affect genuine active transactions.

Pending should represent real pending work, not forgotten historical records.

---

### 4. Perform a Complete Production Audit

Perform a complete audit of FlowPay.

Review:

- gateway abstraction layer
- provider plugins
- webhook verification
- payout engine
- Mode 1
- Mode 2
- orchestration credits
- retry queues
- idempotency
- transaction state machine
- audit logs
- reconciliation
- environment switching
- provider failover
- fee calculation
- API consistency
- security
- tenant isolation
- separation of concerns

Look for:

- architectural gaps
- edge cases
- race conditions
- production risks
- inconsistent naming
- dead code
- duplicated logic
- security weaknesses
- anything that could cause failures after launch

Do not redesign existing architecture unless absolutely necessary.

Focus on refinement, robustness, correctness, maintainability, and production reliability.

---

### 5. Preserve Existing Architecture

Do not remove or replace existing FlowPay concepts.

Preserve:

- Mode 1
- Mode 2
- gateway plugin architecture
- orchestration engine
- provider abstraction
- existing APIs
- current integrations

Only improve, harden, and complete the implementation.

---

### Final Goal

After this audit and refinement, FlowPay should be confidently considered production-ready.

The system should support:

- real live payments
- sandbox testing
- live testing
- environment switching
- reliable collections
- reliable payouts
- gateway abstraction
- future gateway additions
- production stability

Treat this as the final engineering hardening pass before public deployment.