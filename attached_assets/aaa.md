FlowPay has already reached production readiness. The existing payment orchestration, treasury foundation, gateway integrations, billing engine, credits, Mode 1 / Mode 2 architecture, routing, and Fapshi production integration are already implemented and working correctly. This is NOT a request to rebuild or redesign existing functionality. Treat this as an architectural hardening and scalability refinement.

Before making any changes, thoroughly inspect the existing codebase, database schema, services, treasury implementation, billing engine, gateway abstraction layer, withdrawal flow, credit system, and administrative interfaces. First determine whether each concern below is already handled. If it is already correctly implemented, do not duplicate or replace it. Only improve or extend where genuine gaps exist. Maintain full backward compatibility and avoid regressions.

The investigation should focus on the following areas:

1. Gateway-aware Treasury Architecture

FlowPay is designed to support multiple payment operators (Fapshi, Campay, Flutterwave, CinetPay, Maviance, and future providers). Platform revenue is logically unified inside FlowPay but, physically, funds are distributed across the respective operator balances.

Ensure the treasury architecture is gateway-aware.

The system should always know:

- which gateway generated each platform fee;
- which gateway currently holds those funds;
- cumulative platform revenue per gateway;
- withdrawn amount per gateway;
- remaining treasury balance per gateway.

The treasury dashboard may present a unified total for management purposes, but internally every ledger entry and withdrawal must preserve gateway ownership and traceability.

2. Gateway-aware Treasury Withdrawals

Investigate the existing withdrawal implementation.

If withdrawals currently assume a single treasury source, redesign them so they operate against the correct gateway.

Administrators should be able to:

- view FlowPay treasury per gateway;
- view available withdrawable balance for each gateway;
- select the gateway to withdraw from;
- execute withdrawals using that gateway's payout capabilities;
- maintain complete audit history.

The unified treasury must remain a reporting abstraction while withdrawals remain gateway-specific.

3. Platform Revenue vs Credit Architecture

Preserve the conceptual separation between:

- Platform Revenue
- FlowPay Credits

These represent different accounting concepts and must not be merged.

However, investigate whether organizations can already top up Credits directly using their accumulated Platform Revenue.

If this capability does not already exist, determine whether it should be implemented in a clean, auditable way.

The transfer should remain explicit, fully logged, reversible only through proper accounting, and should never compromise financial integrity.

4. Automatic Credit Refill

Investigate whether a configurable automation policy should exist.

Rather than allowing transactions to fail immediately when Credits are exhausted, allow organizations to optionally enable an automatic refill policy.

When enabled:

- FlowPay detects insufficient Credits;
- automatically converts the required amount from Platform Revenue into Credits;
- continues processing transparently;
- records every conversion in the audit trail.

This must remain optional.

Organizations who prefer manual credit management should continue to operate exactly as before.

Do not remove the existing credit model.

5. Accounting Integrity

Ensure that:

- treasury balances;
- platform revenue;
- gateway revenue;
- credit balances;
- withdrawals;
- automatic credit conversions;

all remain mathematically consistent and auditable.

No operation should create discrepancies between internal ledgers and gateway balances.

6. Scalability Review

Review the treasury, billing, gateway abstraction, and financial architecture from the perspective of future scale.

Assume FlowPay may eventually support dozens of operators.

The implementation should remain provider-agnostic, modular, maintainable, and easy to extend without introducing gateway-specific logic into unrelated components.

7. General Production Hardening

After completing the investigation and any necessary improvements:

- verify database integrity;
- verify transaction consistency;
- verify concurrency safety;
- verify financial calculations;
- verify audit logging;
- verify rollback behaviour;
- verify security;
- verify authorization around treasury operations;
- verify no regressions are introduced.

Only implement changes where they genuinely improve the current architecture.

Finally, perform a comprehensive review of the entire financial subsystem and confirm whether FlowPay remains fully production-ready after these enhancements. If any additional architectural improvements naturally emerge during the investigation, implement them only if they clearly improve scalability, maintainability, correctness, or operational robustness without altering existing production behaviour.