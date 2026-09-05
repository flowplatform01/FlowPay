# FlowPay Financial Ownership and Ledger Isolation Audit

## Summary

This audit verified the ownership boundary between FlowPay treasury funds, app-owned Mode 1 revenue, operational credits, and payout flows.

Two production hardening corrections were made:

- App-initiated Mode 1 revenue payout balance checks are now scoped to `organizationId + appId`, not only `organizationId`.
- Automatic operational credit refill now uses the app's own settled Mode 1 revenue, not FlowPay treasury funds.

## Ownership Model

FlowPay has separate financial domains:

- **FlowPay Treasury**: FlowPay-owned platform fees and treasury movements. Recorded in `TreasuryLedgerEntry` and `TreasuryWithdrawal`.
- **App Mode 1 Revenue**: Merchant/application revenue collected through Mode 1 platform-revenue transactions. Sourced from settled `Settlement` rows and owned by the app that created the transaction.
- **Operational Credits**: App infrastructure credits used for orchestration/metering. Stored on `App` and consumed through `OrchestrationMeteringLedger`.
- **Mode 2 Payout Coordination**: Customer-funded coordinated payout flows. Managed separately through payout coordination records and not used as the Mode 1 revenue-payout ledger.

## Corrections Implemented

### App-Owned Revenue Payout Boundary

`RevenuePayout` now has an optional `appId` owner column.

For app-facing payouts:

- collected balance is calculated only from settled Mode 1 transactions where `transaction.appId` matches the calling app;
- reserved/paid payout amount is calculated only from `RevenuePayout` rows owned by that app;
- legacy rows are still supported through metadata fallback during status and balance checks.

This prevents one app under the same organization from withdrawing another app's settled revenue.

### Auto Credit Refill Source

Automatic app credit refill no longer debits FlowPay treasury.

When enabled, it now:

- checks the app's settled Mode 1 revenue balance;
- creates a successful internal `RevenuePayout` allocation owned by that app;
- increases operational credit balances;
- writes an audit log as `app_revenue.credit_refill_auto_funded`.

The explicit admin-only treasury funding route remains separate and intentional.

## Migration

Added migration:

`services/api/prisma/migrations/20260820120000_revenue_payout_app_ownership/migration.sql`

It:

- adds nullable `RevenuePayout.appId`;
- backfills it from existing payout metadata where present;
- adds the foreign key to `App`;
- adds indexes for app/status and app/currency/status lookups.

## Verification

Completed checks:

- Prisma client regenerated successfully.
- API TypeScript check passed.
- Added and ran `revenue-payouts.service.test.ts`.

The regression test verifies:

- app payout balance includes `transaction.appId`;
- app payout reservations filter by `RevenuePayout.appId` or legacy metadata `appId`;
- organization-admin payout balance remains organization scoped.

## Production Notes

Run Prisma migration deploy before relying on this in production:

```bash
npm --workspace @flowpay/api run prisma:deploy
```

Then redeploy FlowPay API and Worker from the same commit so both services use the same generated Prisma client and schema.
