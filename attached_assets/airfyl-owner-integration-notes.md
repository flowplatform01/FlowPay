# Airfyl Integration - FlowPay Owner Notes

Date: 2026-07-06
Audience: FlowPay owner and internal operators only
Status: Internal guidance, not for Airfyl engineers

## Purpose

The public Airfyl review document is intentionally sanitized. It should not expose FlowPay internal provider routing, account capability issues, Flow Admin URLs, or owner-only operating procedures.

This document keeps those private notes separate.

## Fapshi Direct Pay Diagnosis

The recent live Fapshi payment failure is consistent with an account capability issue, not a FlowPay implementation issue.

FlowPay intentionally uses Fapshi Direct Pay rather than Fapshi Initiate Pay because FlowPay owns its own checkout UI and payment state experience.

Direct Pay is the correct architecture when:

- FlowPay renders and controls the customer checkout experience.
- FlowPay presents customer-facing payment rails.
- FlowPay handles its own payment status UX.
- FlowPay keeps provider routing private.

Initiate Pay is not the right default for FlowPay's product vision because it redirects customers to Fapshi-hosted payment pages.

Fapshi documentation states that Direct Pay is disabled by default in live environments. Before approving production integrations that rely on Fapshi live Direct Pay, contact Fapshi support and request live Direct Pay activation.

References:

- https://docs.fapshi.com/en/api-reference/getting-started
- https://docs.fapshi.com/en/api-reference/endpoint/direct-pay
- https://docs.fapshi.com/en/api-reference/endpoint/initiate-pay
- https://www.fapshi.com/en/help-and-support/direct-pay-vs-initiate-pay-all-you-need-to-know

## How To Prepare Airfyl In Flow Admin

Use Flow Admin:

- `http://localhost:5173/flowpay/overview`

Recommended internal workflow:

1. Go to `FlowPay -> Payment Tenants`.
   - Create or select the tenant that will own Airfyl's integration.
   - For Airfyl sandbox, use a dedicated tenant or a clearly labeled sandbox tenant.
   - Keep Airfyl separate from unrelated test tenants.

2. Go to `FlowPay -> App Onboarding`.
   - Create a dedicated Airfyl sandbox app.
   - Configure Airfyl's sandbox webhook URL.
   - Copy the generated public key, secret key, and webhook secret through a secure channel.
   - Do not issue live credentials until sandbox testing passes.

3. Configure destination profile controls for Airfyl withdrawals.
   - Enable app-created destination profiles only when Airfyl's backend is ready.
   - Set conservative sandbox limits.
   - Prefer confirmation or verification for production payout targets.
   - Use auto-verification only where risk is acceptable.

4. Go to `FlowPay -> Provider Routing`.
   - Confirm which customer-facing rails are active for Airfyl sandbox.
   - Keep internal providers hidden from Airfyl-facing UX.
   - If Fapshi live Direct Pay is not enabled, keep production approval blocked or use another approved live route.

5. Go to `FlowPay -> Fees and Billing`.
   - Assign the correct Airfyl fee rule.
   - Confirm whether fees are paid by Airfyl, passed to customers, or handled with a hybrid model.
   - Test low-value and range-based rules if Airfyl will process small payments.

6. Go to `FlowPay -> Developer`.
   - Review Airfyl readiness before handing off credentials.
   - Confirm webhook posture, credential status, environment separation, destination-profile policy, and provider access.

7. Go to `FlowPay -> Operations`.
   - Monitor Airfyl sandbox transactions, payout coordination, webhook delivery, retries, and stuck pending states.
   - Use retry and replay only after checking whether the original transaction is already terminal.

8. Go to `FlowPay -> Treasury`.
   - Use this only for FlowPay-owned treasury movement.
   - Do not confuse FlowPay treasury withdrawals with Airfyl operator withdrawals.
   - Airfyl operator withdrawals belong to Airfyl's app/recipient payout flow.

## Sandbox Recommendation

Use sandbox for Airfyl while live Direct Pay is disabled.

Recommended setup:

- Dedicated Airfyl sandbox app credentials.
- Dedicated sandbox webhook secret.
- Sandbox payment route.
- Safe payment methods only.
- Clear sandbox/live labeling.
- Sandbox-only transaction references.
- Test-only payout behavior where available.

Do not let Airfyl test with production credentials or production provider configuration.

## Production Approval Checklist

Before issuing Airfyl live credentials, verify:

- Airfyl signed webhook receiver works.
- Airfyl handles duplicate webhooks idempotently.
- Airfyl does not credit wallets from redirect callbacks alone.
- Airfyl can reconcile stuck pending payments.
- Airfyl can process failed payments without wallet credit.
- Airfyl can process failed payouts and release reserved funds.
- Airfyl uses backend-only FlowPay credentials.
- Airfyl has no direct provider credentials.
- Airfyl does not expose internal provider names in user-facing UX.
- Destination profile creation is rate-limited and governed.
- Production provider capabilities are enabled.
- A small controlled live pilot succeeds.

## Fapshi Live Steps

Before approving Fapshi-backed production traffic:

1. Ask Fapshi to enable Direct Pay on the live account.
2. Confirm live Direct Pay limits.
3. Confirm supported operators and phone-number formats.
4. Confirm timeout and terminal failure behavior.
5. Confirm live webhook behavior and signatures.
6. Confirm payout availability if Airfyl withdrawals will depend on Fapshi payout.
7. Run a small live payment test after activation.
8. Document fallback behavior if Fapshi Direct Pay is unavailable.

## Credential Handling

Use secure handoff for:

- FlowPay public key.
- FlowPay secret key.
- FlowPay webhook secret.
- Sandbox base URL.
- Production base URL after approval.

Never share:

- Provider credentials.
- FlowPay internal service token.
- Redis URL.
- Database credentials.
- Any private Flow Admin environment variables.

## Final Owner Recommendation

Give Airfyl sandbox access first. Treat the public review as the engineering-facing contract guidance. Keep this file private for FlowPay-side setup, provider activation, and operational approval.
