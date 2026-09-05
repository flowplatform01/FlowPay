# FlowPay Provider Runtime and Credit Hardening

## What changed

FlowPay now supports provider runtime selection without changing the provider's global default for every tenant.

Resolution order is:

1. Application provider access runtime, when set.
2. Organization provider access runtime, when set.
3. Provider Routing's existing global runtime setting.

An unset runtime means **Global**. Existing applications and organizations therefore retain their current behavior until an administrator explicitly chooses Sandbox or Live.

The runtime is persisted with a transaction and reused for deferred checkout charges, Mode 2 coordinated payouts, and Mode 1 app revenue payouts. A transaction cannot switch between sandbox and live after it has been created.

## Flow Admin usage

In **Payment Tenants**, the organization provider settings can set a provider to Global, Sandbox, or Live. In **App Onboarding**, the application access policy can use the same setting as a more specific override. Use an app override only when that app needs isolated testing; otherwise leave it on Global.

## Credit purchases

Credit purchase checkout now requires a valid Cameroon mobile-money payer number and accepts an optional billing email. The payment method is selected explicitly. This prevents a provider request with no payer number from reaching the gateway.

## Provider fee calculation

Provider percentage fees are now grossed up. If a provider charges a percentage of the customer-paid total, FlowPay computes the gross amount needed for the intended net collection instead of undercharging the provider fee.

## Revenue ownership

Application-initiated Mode 1 revenue payouts reserve only revenue collected by that same application. They no longer see another app's revenue merely because both apps belong to the same organization.

## Database migration

Applied to the configured FlowPay database:

- `20260820120000_revenue_payout_app_ownership`
- `20260831120000_app_provider_runtime_mode`

Both migrations are additive. They add application ownership to revenue-payout records, runtime-mode fields to provider access controls, and the required indexes/foreign key.

## Verification

- FlowPay API TypeScript check passed.
- Fee gross-up behavior test passed.
- Mode 1 app revenue balance-isolation test passed.
- Fapshi adapter test passed.
- Flow Admin frontend production build passed.
- Flow Admin backend production build passed.
- Prisma migration status reports the FlowPay database schema is current.

No live provider payment or payout was initiated during this work.

## Fapshi Mode 1 payout finding

The production payout ledger was reviewed without exposing credentials or payout targets.

- Sandbox-routed app revenue payouts completed successfully, including a 4,500 XAF payout on 2026-09-04.
- A live-routed payout on 2026-08-30 received Fapshi HTTP `403` with `Payout not allowed` immediately after Fapshi was switched to Live.
- FlowPay recorded that provider rejection as `FAILED`; it was not left pending.

This is a live Fapshi account capability/authorization requirement, not a missing Mode 1 FlowPay payout lifecycle. Before using Live for an organization or application, Fapshi must enable payout/disbursement access for the live account and the live account must satisfy its funding and recipient requirements. Sandbox and Live should remain deliberately separate through the runtime controls above.
