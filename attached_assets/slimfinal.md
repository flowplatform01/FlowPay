FINAL FLOWPAY POLISHING + PRODUCTION READINESS AUDIT + REAL GATEWAY SANDBOX PREPARATION

Read and fully understand ALL previous architecture prompts and implementation context inside:
- attachment_assets/

This is NOT a feature-generation phase anymore.
This is the FINAL POLISHING + AUDIT + PRODUCTION READINESS phase.

Your mission is to deeply inspect the ENTIRE FlowPay ecosystem and make sure it is:
- production-ready
- secure
- scalable
- polished
- externally integratable
- operationally clear
- frontend complete
- backend stable
- sandbox-ready
- live-ready

WITHOUT breaking architecture.
WITHOUT rewriting stable systems unnecessarily.
WITHOUT overengineering.
WITHOUT turning FlowPay into a bloated product.

==================================================
CORE CONTEXT
==================================================

FlowPay is:
- a centralized payment orchestration platform
- backend-first infrastructure
- managed through Flow Admin
- used by internal Flow apps and future external apps
- NOT a simple payment page
- NOT a direct gateway UI
- NOT exposing internal gateway architecture publicly

FlowPay internally orchestrates:
- CamPay
- Maviance
- CinetPay

But users must NEVER see:
- "Maviance"
- "CinetPay"
- "CamPay"

Users should only see:
- MTN Mobile Money
- Orange Money
- bank transfer options
- supported local payment methods
- payment channels
- telecom/payment provider branding

Gateway providers remain INTERNAL infrastructure.

==================================================
VERY IMPORTANT ARCHITECTURE RULE
==================================================

Flow Admin frontend MUST communicate ONLY with:
- Flow Admin backend

Flow Admin frontend MUST NEVER directly communicate with:
- FlowPay backend

Flow Admin backend orchestrates communication securely.

Maintain strict separation of concerns.

==================================================
PHASE 1 — FULL AUDIT
==================================================

Perform a complete deep audit of:

1. FlowPay backend
2. FlowPay architecture
3. Flow Admin integration
4. Flow Admin frontend
5. Flow Admin backend
6. External test app
7. Public SDK/payment flow
8. Bottom sheet/payment UI flow
9. API contracts
10. Environment handling
11. Redis usage
12. Queue handling
13. Security structure
14. Payment orchestration logic
15. Rule system
16. Fee logic
17. App onboarding system
18. Sandbox/live separation
19. Gateway abstraction layer
20. Error handling
21. Retry handling
22. Webhook handling
23. Logging system
24. Frontend UX quality
25. Frontend state handling
26. Frontend empty/loading/error states
27. Mobile responsiveness
28. Admin dashboards
29. Credential management UX
30. Test mode indicators

==================================================
PHASE 2 — FRONTEND POLISHING
==================================================

IMPORTANT:
Do NOT focus only on backend.

The frontend MUST now receive equal priority.

Inspect the Flow Admin frontend deeply and improve where and if realy necessary.

Make sure the frontend:
- feels production-grade
- feels modern
- feels operational
- feels intelligent
- feels trustworthy
- feels enterprise-ready
- clearly exposes FlowPay capabilities
- is NOT visually empty
- is NOT backend-heavy/frontend-light

Inspect:
- navigation clarity
- onboarding flows
- app setup flows
- API credential screens
- fee/rule configuration UX
- sandbox/live UX
- gateway visibility
- test mode badges
- app environment indicators
- app health indicators
- loading states
- validation UX
- success/error handling
- audit visibility
- logs visibility
- observability UX
- app status cards
- transaction visibility
- configuration clarity
- admin usability
- settings clarity
- responsive behavior

The frontend must expose FlowPay power clearly.

==================================================
PHASE 3 — FLOWPAY BRANDING + PAYMENT EXPERIENCE
==================================================
Maintain strong FlowPay branding.

But branding must be:
- elegant
- trusted
- subtle
- premium
- modern
- not noisy
- not gateway-centric

The payment bottom sheet/public payment flow should:
- feel branded by FlowPay
- feel secure
- feel modern
- feel lightweight
- feel smooth
- feel mobile-first

BUT:
Do NOT expose internal providers.

Example:
GOOD:
- MTN Mobile Money
- Orange Money
- Visa
- Bank Transfer

BAD:
- Maviance
- CinetPay
- CamPay

Gateway routing must remain internal orchestration logic.

==================================================
PHASE 4 — APP ONBOARDING + APP REGISTRATION
==================================================

Verify and improve the system for onboarding apps into FlowPay.

FlowPay must support:
- internal Flow apps
- future external apps

Admin must be able to:
- create/register apps
- issue credentials
- rotate credentials
- revoke credentials
- manage environments
- manage sandbox/live modes
- view app status
- activate/deactivate apps

Inspect if the following already exist properly:
- public key generation
- secret key generation
- environment separation
- sandbox credentials
- live credentials
- credential rotation
- app-level permissions
- API scopes
- webhook setup
- callback setup

If missing or weak:
Implement properly.

==================================================
PHASE 5 — FEE + RULE ENGINE
==================================================

Deeply inspect fee/rule architecture.

FlowPay must NOT hardcode business logic.

FlowPay should support configurable:
- platform fees
- percentage fees
- flat fees
- routing rules
- provider priority
- transaction limits
- environment rules
- app-level rules
- provider enable/disable rules

Admin UI must allow:
- configuring rules
- editing rules
- viewing rules
- activating/deactivating rules

Rules should drive automation.

FlowPay should become autonomous AFTER setup.

==================================================
PHASE 6 — SANDBOX VS LIVE
==================================================

Ensure STRICT separation between:
- sandbox
- live

Flow Admin must clearly show:
- sandbox apps
- live apps
- environment status
- active credentials
- test mode indicators
- production mode indicators

Prevent environment leakage.

Ensure:
- sandbox credentials cannot hit live
- live credentials cannot hit sandbox accidentally

==================================================
PHASE 7 — SECURITY + PRODUCTION READINESS
==================================================

Perform production-grade hardening.

Inspect:
- auth
- RBAC
- API security
- request validation
- webhook validation
- secret handling
- encryption handling
- credential exposure
- frontend secret leakage
- environment safety
- rate limiting
- Redis usage
- queue stability
- idempotency
- duplicate payment prevention
- transaction replay protection
- audit logs
- operational logs
- monitoring readiness

Ensure:
NO mock/demo architecture remains.

==================================================
PHASE 8 — REAL GATEWAY SANDBOX PREPARATION
==================================================

IMPORTANT:
The real gateway credentials are NOT yet added.

Prepare the system properly for:
- CamPay sandbox
- Maviance sandbox
- CinetPay sandbox

Do NOT require real credentials now.

Instead:
- verify adapters
- verify architecture
- verify provider abstraction
- verify environment readiness
- verify fallback handling
- verify routing readiness
- verify provider configuration structure

Ensure the system is READY for real sandbox credentials insertion.

==================================================
PHASE 9 — TESTING
==================================================

Run deep testing:
- frontend testing
- backend testing
- integration testing
- payment flow testing
- sandbox flow testing
- external app integration testing
- app onboarding testing
- API key testing
- webhook testing
- rule testing
- fee testing
- queue testing
- Redis testing
- environment testing
- bottom sheet testing
- responsive testing

Test BOTH:
- Flow Admin
- FlowPay backend
- external test app
==================================================
PHASE 10 — FINAL CLEANUP
==================================================

After all improvements:
- clean architecture
- remove dead code
- remove fake/demo logic
- remove unstable experiments
- clean naming inconsistencies
- improve maintainability
- improve developer clarity
- improve production clarity

==================================================
IMPORTANT RULES
==================================================

DO NOT:
- rewrite stable systems unnecessarily
- overcomplicate architecture
- break working systems
- introduce unnecessary abstractions
- expose internal gateway providers publicly
- destroy frontend usability
- create backend-heavy/frontend-blind architecture

DO:
- preserve architecture integrity
- preserve Flow vision
- preserve scalability
- preserve production readiness
- preserve observability
- preserve separation of concerns
- preserve FlowPay branding

==================================================
FINAL REQUIREMENT
==================================================

At the end:
1. explain all findings
2. explain all fixes
3. explain all improvements
4. explain all risks found
5. explain all production readiness upgrades
6. explain all frontend improvements if there was
7. explain all backend improvements
8. explain all environment improvements
9. explain all integration improvements
10. explain remaining recommendations before live deployment

Then:
- run the system
- preview frontend
- preview backend
- preview external test app
- ensure all ports respect .env
- kill conflicting ports if necessary
- ensure system stability

The final result must feel like:
a real production-grade African fintech orchestration platform.
IMPORTANT ADDITIONAL NOTE

The repository also contains a FlowPay external test app used for real integration simulation and developer experience testing.

You MUST make heavy use of this external test app during:
- integration testing
- SDK/public key testing
- payment flow testing
- bottom sheet testing
- frontend testing
- environment testing
- sandbox/live separation testing
- callback testing
- webhook testing
- app onboarding validation
- credential validation
- API communication validation

Treat this external test app as:
- a real third-party client app
- a real developer integration example
- a real FlowPay consumer

You must verify that:
- the external app integrates correctly
- public keys work correctly
- secret keys work correctly
- sandbox credentials behave correctly
- environment separation works correctly
- the payment bottom sheet behaves correctly
- payment routing behaves correctly
- callbacks behave correctly
- FlowPay branding behaves correctly
- frontend UX feels production-ready
- no internal gateway providers are exposed publicly
- external integration developer experience is smooth and modern

The external app should help validate that FlowPay is truly ready for:
- external integrations
- future public SDK usage
- real-world production onboarding

If necessary:
- improve the external test app
- improve integration flows
- improve SDK behavior
- improve frontend interaction quality
- improve developer integration clarity
- improve payment lifecycle handling

But do NOT overengineer or break stable architecture.
