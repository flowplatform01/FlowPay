PROJECT CONTEXT

FlowPay is already a production-grade payment orchestration engine with an existing provider abstraction layer and multiple gateway integrations. Existing providers include CamPay, Flutterwave, CinetPay, Monetbil, and Maviance.

We have now successfully obtained verified LIVE production credentials from Fapshi and are adding Fapshi as a new provider adapter inside the existing FlowPay architecture.

IMPORTANT:

Do NOT redesign FlowPay.

Do NOT replace existing providers.

Do NOT change the core Mode 1 and Mode 2 architecture.

Treat Fapshi as a new provider plugin/adapter that integrates into the existing provider abstraction layer.

BACKGROUND

CamPay was previously used for development and testing but production usage is blocked by live account requirements and transaction limitations.

Fapshi now provides real production-ready collection and payout capabilities and will become the primary provider for initial production operations.

OBJECTIVES

1. Read and analyze the complete Fapshi documentation:

https://docs.fapshi.com

2. Implement a production-grade Fapshi provider adapter.

3. Support:

- Payment collection
- Payment status verification
- Webhook processing
- Balance retrieval
- Payout/disbursement operations


4. Ensure Fapshi fully integrates into the existing FlowPay provider routing layer.

5. Preserve provider-agnostic architecture.

FLOWPAY REQUIREMENTS

Implement:

- FapshiProvider
- FapshiCollectionAdapter
- FapshiPayoutAdapter
- FapshiWebhookHandler
- FapshiBalanceService

Map Fapshi operations into existing FlowPay contracts and interfaces.

Do not create Fapshi-specific business logic outside provider boundaries.

WEBHOOKS

Read the documentation and implement:

- Signature verification
- Replay protection
- Idempotency protection
- Event validation
- Secure callback processing

All webhook events must flow into existing FlowPay transaction state management.

TESTING

Create comprehensive tests for:

- Successful collections
- Failed collections
- Pending collections
- Successful payouts
- Failed payouts
- Webhook processing
- Duplicate webhook handling
- Provider timeout scenarios
- Retry logic

MODE 2 COMPATIBILITY

Ensure Fapshi supports existing FlowPay mirror-routing behavior:

Customer → Collection → Verification → Payout → Recipient

If Fapshi lacks native split-account support, FlowPay must continue using its existing orchestration engine for one-to-many payout routing.

This means FlowPay may collect once and execute multiple payouts programmatically while preserving transaction integrity.

PRODUCTION HARDENING

Validate:

- Environment variables I just set/added in FlowPay
- Secrets management
- Logging
- Error handling
- Rate limiting awareness
- Monitoring hooks
- Health checks

DELIVERABLE

After implementation:

1. Verify collections work.
2. Verify payouts work.
3. Verify webhook processing works.
4. Verify routing works.
5. Verify existing providers remain unaffected.
6. Verify FlowPay remains production-ready and provider-agnostic.

Provide a final implementation report listing:
- Files modified
- API endpoints integrated
- Test results
- Remaining setup actions required by the operator.PROJECT CONTEXT

FlowPay is already a production-grade payment orchestration engine with an existing provider abstraction layer and multiple gateway integrations. Existing providers include CamPay, Flutterwave, CinetPay, Monetbil, and Maviance.

We have now successfully obtained verified LIVE production credentials from Fapshi and are adding Fapshi as a new provider adapter inside the existing FlowPay architecture.

IMPORTANT:

Do NOT redesign FlowPay.

Do NOT replace existing providers.

Do NOT change the core Mode 1 and Mode 2 architecture.

Treat Fapshi as a new provider plugin/adapter that integrates into the existing provider abstraction layer.

BACKGROUND

CamPay was previously used for development and testing but production usage is blocked by live account requirements and transaction limitations.

Fapshi now provides real production-ready collection and payout capabilities and will become the primary provider for initial production operations.

OBJECTIVES

1. Read and analyze the complete Fapshi documentation:

https://docs.fapshi.com

2. Implement a production-grade Fapshi provider adapter.

3. Support:

- Payment collection
- Payment status verification
- Webhook processing
- Balance retrieval
- Payout/disbursement operations


4. Ensure Fapshi fully integrates into the existing FlowPay provider routing layer.

5. Preserve provider-agnostic architecture.

FLOWPAY REQUIREMENTS

Implement:

- FapshiProvider
- FapshiCollectionAdapter
- FapshiPayoutAdapter
- FapshiWebhookHandler
- FapshiBalanceService

Map Fapshi operations into existing FlowPay contracts and interfaces.

Do not create Fapshi-specific business logic outside provider boundaries.

WEBHOOKS

Read the documentation and implement:

- Signature verification
- Replay protection
- Idempotency protection
- Event validation
- Secure callback processing

All webhook events must flow into existing FlowPay transaction state management.

TESTING

Create comprehensive tests for:

- Successful collections
- Failed collections
- Pending collections
- Successful payouts
- Failed payouts
- Webhook processing
- Duplicate webhook handling
- Provider timeout scenarios
- Retry logic

MODE 2 COMPATIBILITY

Ensure Fapshi supports existing FlowPay mirror-routing behavior:

Customer → Collection → Verification → Payout → Recipient

If Fapshi lacks native split-account support, FlowPay must continue using its existing orchestration engine for one-to-many payout routing.

This means FlowPay may collect once and execute multiple payouts programmatically while preserving transaction integrity.

PRODUCTION HARDENING

Validate:

- Environment variables I just set/added in FlowPay
- Secrets management
- Logging
- Error handling
- Rate limiting awareness
- Monitoring hooks
- Health checks

DELIVERABLE

After implementation:

1. Verify collections work.
2. Verify payouts work.
3. Verify webhook processing works.
4. Verify routing works.
5. Verify existing providers remain unaffected.
6. Verify FlowPay remains production-ready and provider-agnostic.

Provide a final implementation report listing:
- Files modified
- API endpoints integrated
- Test results
- Remaining setup actions required by the operator.

### FAPSHI FINAL INTEGRATION ADDENDUM

This is not a fresh integration. All manual setup has already been completed.

Current status:

- Live Fapshi account is verified and active.
- API credentials have already been collected and stored in FlowPay environment variables.
- Webhook URL has already been configured in the Fapshi dashboard.
- Webhook secret has already been created and configured on both FlowPay and Fapshi.
- All required environment variables already exist inside the FlowPay environment configuration.
- No additional manual setup should be requested unless a genuine blocker is detected.

Your task is now purely implementation, validation, hardening, and production-readiness.

Requirements:

1. Read all existing Fapshi-related environment variables from the FlowPay environment configuration.
2. Implement the Fapshi provider adapter according to the official documentation.
3. Integrate Fapshi into the existing provider abstraction layer and routing engine without breaking existing providers.
4. Ensure Fapshi works as a first-class FlowPay provider, not as a special-case integration.
5. Implement:
   - Payment initiation
   - Payment status verification
   - Webhook processing
   - Webhook signature validation
   - Transaction reconciliation
   - Payout/disbursement support (if available and enabled on the account)
6. Ensure all provider states map correctly into FlowPay's internal transaction lifecycle.
7. Verify compatibility with:
   - Mode 1 (Platform Revenue)
   - Mode 2 (Orchestration / Peer-to-Peer Routing)
   - Existing failover and routing infrastructure
8. Execute end-to-end testing using the live-ready configuration.
9. Validate webhook delivery, processing, retries, and idempotency protections.
10. Ensure duplicate webhooks cannot create duplicate transactions or duplicate payouts.
11. Ensure proper logging, observability, and failure recovery.
12. Verify that transaction states remain consistent during:
    - Network failures
    - Provider timeouts
    - Duplicate callbacks
    - Delayed confirmations
13. Harden the implementation for production usage.
14. Preserve all existing architecture and provider integrations.
15. Do not request additional setup steps unless an actual technical blocker is encountered.

Primary objective:

Treat Fapshi as the production-ready gateway that unlocks real-world FlowPay operation today. Complete the implementation, testing, validation, and hardening necessary for FlowPay to operate reliably in production using Fapshi while maintaining the existing provider-agnostic architecture.