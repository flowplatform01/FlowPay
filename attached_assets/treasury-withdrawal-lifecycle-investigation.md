# Treasury Withdrawal Lifecycle Investigation

## Scope

This is an investigation of FlowPay Treasury withdrawals only. Treasury is platform-owned money and is intentionally separate from tenant Mode 1 revenue payouts and Mode 2 coordinated recipient payouts.

## Current Lifecycle

1. A super-admin creates a withdrawal. FlowPay validates the provider-specific treasury balance, creates a `PENDING_APPROVAL` `TreasuryWithdrawal`, and writes a `WITHDRAWAL_RESERVED` debit ledger entry.
2. A separate approval moves it to `APPROVED`.
3. The execute action atomically claims the approval by moving the withdrawal to `PROCESSING`, then calls the selected gateway adapter's `executePayout` method using the withdrawal idempotency key.
4. An immediate provider success calls `markTreasuryWithdrawalSucceeded`. The reserve is voided and one `WITHDRAWAL_EXECUTED` settled debit is written.
5. An immediate provider failure calls `reverseTreasuryWithdrawal`. The withdrawal is failed and a compensating `WITHDRAWAL_REVERSED` credit is written.
6. An immediate provider pending result is persisted as `PROCESSING` with the provider reference and raw response payload.

## Confirmed Original Gap

The `PROCESSING` branch has no completion owner in the current Treasury module:

- no worker sweep selects processing `TreasuryWithdrawal` records;
- no Treasury-specific provider-status lookup is scheduled;
- gateway webhook processing resolves transactions and revenue payouts, not `TreasuryWithdrawal` records;
- no retry/reconciliation record is created for a pending Treasury withdrawal.

Therefore a provider that accepted a Treasury payout asynchronously could leave the FlowPay Treasury record in `PROCESSING` indefinitely. The reserved ledger debit remained in place, which protected the balance from being spent twice, but the operation had no final-state owner.

## Implemented Correction

FlowPay now provides a Treasury-only asynchronous completion path:

1. The dedicated worker scans a bounded set of `PROCESSING` Treasury withdrawals with a provider reference after a short delay.
2. It calls the configured gateway adapter's payout status lookup using the payout operation context.
3. An authoritative success atomically marks the withdrawal successful, voids the reserve, and writes the settled execution debit.
4. An authoritative failure atomically fails the withdrawal and writes the compensating ledger credit.
5. A pending status remains processing and retains the latest provider payload.
6. Gateway webhooks also attempt to finalize matching Treasury withdrawals as the fast path. Worker reconciliation remains the fallback.

Every terminal transition uses a compare-and-set update constrained to `PROCESSING`. This makes delayed or duplicate webhooks, repeated worker sweeps, and multiple worker instances idempotent: only the first terminal transition can affect the ledger.

## Pending Withdrawal Evidence Still Required

The pending withdrawal must be inspected before a fix is made. The relevant evidence is:

- `TreasuryWithdrawal.providerReference`, `responsePayload`, `attempts`, and `failureReason`;
- matching provider payout result for that reference;
- gateway webhook logs, if any;
- the corresponding `WITHDRAWAL_RESERVED` ledger entry and audit log.

The requested read-only database lookup could not be run in this session because the local Node runtime is unavailable and the execution environment denied the elevated fallback. No production record was changed and no conclusion has been invented about whether the provider accepted, failed, or never received this particular payout.

The pending record should still be inspected after deployment to identify whether the provider accepted, failed, or never received that historical payout. The new reconciler will process it automatically only when it has a provider reference and the selected adapter exposes payout status lookup.

This correction does not merge Treasury with Mode 1 or Mode 2. It gives the existing Treasury lifecycle its missing asynchronous completion path.
