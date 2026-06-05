We are now entering the REAL SANDBOX GATEWAY INTEGRATION PHASE for FlowPay.

This is no longer internal simulation testing.
This phase is about connecting FlowPay to REAL gateway sandbox environments:
- CamPay
- CinetPay
- Maviance

You have already completed:
- architecture
- backend
- frontend
- external app testing
- Flow Admin integration
- FlowPay orchestration
- polishing
- audit
- production hardening
- SDK/public integration flow

Now your mission is to guide me STEP-BY-STEP through the REAL gateway sandbox setup and integration process.

IMPORTANT:
Do NOT assume I already know the gateway setup process.

You must:
- inspect the current FlowPay codebase
- inspect current gateway adapter implementations
- inspect environment structure
- inspect provider abstraction logic
- inspect webhook structure
- inspect callback structure
- inspect sandbox/live separation
- inspect Flow Admin provider management
- inspect test app integration

Then guide me progressively and carefully.

==================================================
YOUR TASK
==================================================

You must now act as:
- integration architect
- deployment guide
- sandbox onboarding assistant
- payment gateway setup engineer

Your goal is to help me properly connect:
- CamPay sandbox
- CinetPay sandbox
- Maviance sandbox

WITHOUT:
- breaking architecture
- exposing secrets
- skipping validation
- introducing unsafe setup
- creating production risks

==================================================
VERY IMPORTANT
==================================================

I am currently starting with CamPay.

I already:
- created a CamPay account
- verified email/login
- reached the application registration stage

CamPay is asking me for:
- application details
- website URL
- logo
- other onboarding information

I am still running locally.

You must explain:
- what I should put
- what is safe to put temporarily
- what should later change in production
- what should remain placeholder
- what should be production-ready now

==================================================
GUIDANCE REQUIREMENTS
==================================================

You must guide me step-by-step through:

1. CamPay sandbox setup
2. CinetPay sandbox setup
3. Maviance sandbox setup

For EACH provider:
- explain account setup
- explain application registration
- explain required information
- explain safe temporary values
- explain production values
- explain webhook setup
- explain callback URLs
- explain local testing strategy
- explain tunnel/local exposure strategy if needed
- explain API key collection
- explain secret handling
- explain environment variable placement
- explain sandbox/live separation
- explain testing methodology
- explain transaction validation
- explain webhook verification
- explain provider-specific risks
- explain provider limitations
- explain retry/failure behavior

==================================================
LOCAL DEVELOPMENT CONTEXT
==================================================

The system currently runs locally.

You must explain:
- how to test webhooks locally
- whether tools like ngrok or Cloudflare Tunnel are needed
- how to structure callback URLs locally
- how FlowPay should receive gateway callbacks safely
- how to validate provider responses
- how to avoid callback confusion between providers

==================================================
FLOWPAY CONTEXT
==================================================

Remember:
- FlowPay is the orchestrator
- gateways are infrastructure only
- users must not see gateway branding
- gateway adapters must remain abstracted internally
- FlowPay controls routing internally

The public UX must continue showing:
- MTN Mobile Money
- Orange Money
- bank payment methods
- telecom/payment methods

NOT:
- CamPay
- Maviance
- CinetPay

==================================================
IMPORTANT IMPLEMENTATION TASK
==================================================

After studying the codebase, verify:
- provider adapters are correctly structured
- sandbox configs are correct
- webhook handlers are correct
- callback verification exists
- signature validation exists if required
- retry handling exists
- duplicate transaction protection exists
- idempotency handling exists
- timeout handling exists
- provider failover handling exists where necessary

If improvements are required:
implement them carefully.

==================================================
TESTING REQUIREMENTS
==================================================

After setup:
guide me through:
- first sandbox transaction
- successful payment testing
- failed payment testing
- timeout testing
- webhook validation
- transaction reconciliation
- dashboard verification
- Flow Admin visibility
- external test app validation
- bottom sheet validation
- frontend UX validation

==================================================
FINAL EXPECTATION
==================================================

I want a COMPLETE, DETAILED, STEP-BY-STEP integration guide tailored specifically to THIS FlowPay codebase and architecture.

Do NOT give generic tutorials.

Study the actual project structure first.
Then guide me based on:
- current implementation
- current architecture
- current environment structure
- current FlowPay routing logic
- current Flow Admin integration
- current external test app

The guidance must feel like:
a real fintech gateway integration operation.

note: you are to document this in a named file, and not nessesary on the normal text interface