# Fapshi Credential Separation

Fapshi Direct Pay collections and Fapshi disbursements are separate services. FlowPay now selects credentials by operation, not merely by gateway and environment.

| FlowPay operation | Fapshi endpoint family | Required credentials |
| --- | --- | --- |
| Customer collection | `/direct-pay`, collection status, balance | `FAPSHI_*_API_USER` and `FAPSHI_*_API_KEY` |
| Revenue or merchant payout | `/payout`, payout status reconciliation | `FAPSHI_*_PAYOUT_API_USER` and `FAPSHI_*_PAYOUT_API_KEY` |

The payout credentials are deliberately not allowed to fall back to Direct Pay credentials. A missing payout pair fails the payout safely with a clear configuration error rather than silently sending the request to the wrong Fapshi service.

For production, configure the same four payout variables on both the FlowPay API and FlowPay Worker services, then redeploy both services:

```text
FAPSHI_SANDBOX_PAYOUT_API_USER
FAPSHI_SANDBOX_PAYOUT_API_KEY
FAPSHI_LIVE_PAYOUT_API_USER
FAPSHI_LIVE_PAYOUT_API_KEY
```

Do not place those values in any third-party application environment. They are FlowPay provider credentials. Merchant applications continue to use their own FlowPay API credentials and webhook secret.

## Transient Collection Failures

FlowPay treats Fapshi HTTP `408`, `425`, `429`, and `5xx` Direct Pay responses as an uncertain provider outcome, not as a confirmed payment failure.

- If Fapshi returned a confirmed provider reference, FlowPay keeps the transaction processing and retries status reconciliation only. It does not submit another charge.
- If no provider reference was returned, FlowPay does not retry the charge request because provider receipt is unknowable and a second submission could duplicate a debit. The transaction is held briefly, then moved to `UNDER_REVIEW` if no authoritative reference becomes available.
- Explicit provider terminal statuses and non-transient validation/configuration errors remain failed with the original provider reason.
