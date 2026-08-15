# Revenue Payout Webhook and Reconciliation Review

## Scope

This review covers FlowPay Mode 1 revenue payout completion from application request through FlowPay, provider execution, provider webhook/status confirmation, app webhook delivery, and Flow Admin visibility.

## Architecture Finding

Mode 1 revenue payouts are modeled as `RevenuePayout` records. They are not Mode 2 payout coordinations. Mode 2 remains the customer-funded coordinated payout flow, while Mode 1 payout is the controlled exit path for settled platform revenue.

## Current Lifecycle

1. An application requests a payout through the app-facing payout API.
2. FlowPay validates app status, payout capability, provider access, destination profile verification, currency, and available settled Mode 1 revenue.
3. FlowPay creates a `RevenuePayout` reservation.
4. FlowPay submits the payout to the selected provider.
5. If the provider returns a terminal status, FlowPay finalizes the payout immediately.
6. If the provider returns accepted/pending, FlowPay stores the provider reference and retries by checking provider status.
7. Provider webhooks now also update `RevenuePayout` records directly when they are not linked to a normal payment transaction.
8. FlowPay sends the final app-facing payout webhook when the revenue payout succeeds, fails, or requires review.

## Production Finding

The stuck Airfyl Mode 1 payout reached Fapshi successfully enough for Fapshi to accept the request, but FlowPay did not receive a provider webhook for it. The provider payload also showed the old webhook URL, which explains why FlowPay had no `WebhookLog` entry for that payout.

FlowPay then exhausted retry attempts and marked the payout as failed with:

`Provider accepted revenue payout but did not return a terminal confirmation after all retry attempts`

The important implementation gap was that accepted revenue payouts were retried by calling payout execution again instead of first reconciling the stored provider reference. That could create multiple provider payout attempts for one FlowPay revenue payout.

The app callback path also showed a separate production configuration issue: Airfyl rejected FlowPay app webhooks with HTTP 401 `invalid_signature`. Airfyl verifies app webhooks using `FLOWPAY_WEBHOOK_SECRET`. That value must be Airfyl's app-specific `fwhsec_...` secret returned by FlowPay onboarding or webhook-secret rotation, not FlowPay's internal provider/platform signing secret.

## Correction

FlowPay now preserves the existing reconciliation model and adds two protections:

- If a revenue payout already has a provider reference, worker retries check provider status instead of initiating another payout.
- If a provider webhook arrives for a payout, the normal webhook endpoint falls through to `RevenuePayout` handling when no payment transaction matches.

This gives FlowPay both:

- fast webhook-based finalization when provider webhooks arrive;
- status-check fallback when webhooks are delayed, missing, or temporarily misconfigured.

## Duplicate and Out-of-Order Handling

- Duplicate webhooks are deduplicated through `WebhookLog` request IDs.
- A webhook matching the current payout status is treated as already processed.
- A succeeded payout is protected from later non-success terminal downgrades.
- Missing webhooks are handled by stored provider-reference reconciliation.

## Operational Notes

- Fapshi webhook URL and secret must remain configured consistently with FlowPay production.
- FlowPay API and FlowPay Worker both need provider runtime credentials because the API creates sessions and the worker executes queued provider work.
- Airfyl production `FLOWPAY_WEBHOOK_SECRET` must equal Airfyl's app-specific FlowPay `fwhsec_...` webhook secret; otherwise Airfyl will reject final payment and payout callbacks even when FlowPay has finalized them.
- The local production build check was blocked by a Windows Prisma query-engine DLL file lock while local services were running. The API TypeScript check passed.

## Verification Completed

- Verified Mode 1 payout is implemented as `RevenuePayout`, not Mode 2.
- Verified FlowPay stores provider payout references in `responsePayload`.
- Verified recent production payout had no Fapshi `WebhookLog` entries.
- Verified latest provider status for the stuck payout reference was terminal failed.
- Verified Airfyl production webhook delivery failures were signature mismatches, not FlowPay payout-domain errors.
- Verified API TypeScript compilation with `tsc --noEmit`.

## Production Recommendation

Deploy the webhook and reconciliation hardening before re-testing Mode 1 payout. After deployment, create a fresh small sandbox/live payout and verify:

- the first provider acceptance stores a provider reference;
- worker retry checks status instead of creating a second payout;
- provider webhook, if delivered, finalizes the same `RevenuePayout`;
- app payout webhook reaches Airfyl with a valid signature;
- Flow Admin shows a terminal payout state instead of indefinite pending/review.
