READ CAREFULLY AND IMPLEMENT CAREFULLY.

First, go and re-read ALL these attached files before making any change:

Flowpay\attached_assets\MASTER PROMPT.md
Flowpay\attached_assets\NEW PROMPT.md
Flowpay\attached_assets\slim.md

You must fully understand the original architecture vision before continuing.

====================================================
CRITICAL GOAL
====================================================

FlowPay must NOT behave like a hardcoded startup payment.

FlowPay must evolve into a:
- production-ready payment orchestration platform
- autonomous payment infrastructure service
- scalable internal fintech backbone for the entire Flow ecosystem
- future-proof payment engine
- smart orchestration layer between apps and gateways
- configurable system with clear separation of concerns

FlowPay is NOT tied to Campus only.

FlowPay must support apps (through onboarding setups, not had coded):
- Campus
- FlowShop
- future Flow apps
- external partner apps in future
- sandbox/live environments
- multiple gateways 
- multiple business models
- future expansion without refactoring architecture

====================================================
VERY IMPORTANT ARCHITECTURE CORRECTION
====================================================

Ensure architecture is CORRECT:

❌ WRONG:
Flow Admin Frontend → directly communicates with FlowPay backend

✅ CORRECT:
Flow Admin Frontend
→ communicates ONLY with Flow Admin Backend

Flow Admin Backend
→ orchestrates and securely communicates with FlowPay Backend APIs/services

FlowPay Backend
→ handles payment intelligence, orchestration, providers, routing, fee logic, rules, transactions, webhooks, settlements, retries, audits, sandbox/live handling, etc.

This separation is NON-NEGOTIABLE.

Re-check entire architecture and refactor if necessary.

====================================================
ENV + PORT RULES
====================================================

Read and respect ALL existing .env files.

Required:
- frontend .env
- backend .env
- flowpay .env

Requirements:
- respect existing ports
- automatically kill occupied ports before starting services
- preview frontend properly
- preview backend properly
- preview FlowPay services properly
- ensure services boot successfully
- ensure no port conflicts

FlowPay already has:
- DATABASE_URL
- REDIS_URL

If missing:
- auto-generate secure GW_SECRET
- auto-generate secure ENCRYPTION_KEY

Do NOT require real CamPay/Maviance/CinetPay keys for system validation right now.

System must:
- work in simulation mode
- support mocked provider adapters
- remain production-ready structurally

====================================================
VERY IMPORTANT (the main critical ): FLOWPAY MUST BECOME CONFIGURABLE
====================================================

Currently many things may still be hardcoded.

That is NOT acceptable.

FlowPay must support proper setup/configuration panels inside Flow Admin.

====================================================
YOU MUST VERIFY / IMPLEMENT THESE MAJOR AREAS
====================================================

1. APP ONBOARDING SYSTEM
--------------------------------

I must be able to:
- create/register an app
- onboard apps into FlowPay
- generate credentials securely
- manage app environments
- enable sandbox/live mode
- revoke/rotate credentials

Examples:
- Campus
- FlowShop
- future apps

Each onboarded app should have:
- app id
- public key
- secret key
- webhook secret
- environment separation
- permissions/scopes
- status
- timestamps
- audit tracking

The app backend should use secret credentials.
Frontend/public integrations should use public credentials.

This setup must be manageable visually from Flow Admin UI.

====================================================

2. PLATFORM FEES + RULE ENGINE
--------------------------------

This is EXTREMELY IMPORTANT.

FlowPay must NOT hardcode fees.

I must be able to configure:
- percentage fees
- fixed fees
- hybrid fees
- provider-specific fees
- app-specific fees
- transaction rules
- settlement rules
- split logic
- payout routing rules
- limits
- thresholds
- retry rules
- fallback rules

Example:
Campus requests payment:
100,000 FCFA

FlowPay can:
- apply platform fee
- apply provider fee
- apply split logic
- compute total payable
- route settlement correctly

Apps only send:
- amount
- metadata
- transaction intent
- user context

FlowPay handles orchestration.

FlowPay must become rules-driven and configuration-driven.

NO HARDCODED BUSINESS LOGIC.

Need proper:
- fee management UI
- rule setup UI
- validation
- previews/simulations
- auditability

====================================================

3. SANDBOX VS LIVE MODE
--------------------------------

Must have STRICT separation.

Apps should:
- onboard in sandbox
- test integration
- test billing flows
- test webhooks
- test transactions
- move to live later

FlowPay must isolate:
- transactions
- logs
- keys
- routing
- provider configs
between sandbox and live.

====================================================

4. PAYMENT PROVIDER ABSTRACTION
--------------------------------

Users should NEVER see:
- CamPay
- Maviance
- CinetPay

Users only see:
- MTN MoMo
- Orange Money
- Bank Transfer
- Card
etc.
(With their real logos, setup already)

FlowPay internally decides provider routing.

Provider abstraction layer must exist.

====================================================

5. PAYMENT METHOD POLICY SYSTEM
--------------------------------

Apps should control allowed methods.

Example:
In Campus A school enables:
- MTN
- Orange
- 2 banks only

Then FlowPay only displays those methods.

This means:
Campus controls school payment configuration.
FlowPay respects policy payload/configuration.

Clear separation of concerns.

====================================================

6. FLOWPAY AUTONOMOUS OPERATION
--------------------------------

FlowPay should become:
- intelligent
- autonomous
- self-orchestrating

Meaning:
Most operations happen automatically.

BUT:
Some things MUST remain manually configurable by platform owner.

Examples:
- fee setup
- routing setup
- onboarding setup
- environment setup
- payout policies
- provider activation
- risk policies

The system should:
- use those configurations
- autonomously execute operations afterward

====================================================

7. FLOWPAY ADMIN EXPERIENCE
--------------------------------

Flow Admin UI for FlowPay must become:
- production-grade
- organized
- operational
- observability-focused
- clean
- scalable

Need proper sections such as:
- Dashboard
- Apps
- API Credentials
- Transactions
- Sandbox
- Live
- Providers
- Rules
- Fees
- Routing
- Webhooks
- Logs
- Audit Trails
- Risk
- Compliance
- Payouts
- Monitoring
- Health Status
-branding (

UI/UX must feel modern and operational if not done or done well .

====================================================

8. KYC / COMPLIANCE BOUNDARY
--------------------------------

Apps own their own user KYC logic.

FlowPay should NOT own app business logic.

Example:
Campus decides:
- which schools can use payments
- school validation
- onboarding requirements

FlowPay only handles:
- orchestration
- provider compliance boundaries
- transaction compliance events if needed

Clear boundaries required.

====================================================

9. FLOWPAY BOTTOM SHEET SDK CONCEPT
--------------------------------

FlowPay should support future frontend integration SDK architecture.

Meaning:
Apps can integrate FlowPay payment UI.

Future-ready architecture:
- public key
- payment initialization
- branded bottom sheet/modal
- secure transaction orchestration
- provider abstraction

Do NOT overbuild now.
But architecture must be prepared.

====================================================

10. TESTING + VALIDATION
--------------------------------

Conduct REAL validation.

NOT fake/demo validation.

You must:
- inspect architecture
- inspect boundaries
-inspect 
- inspect service communication
- inspect auth
- inspect key handling
- inspect environment isolation
- inspect Redis usage
- inspect queues/jobs
- inspect database schema
- inspect migrations
- inspect API contracts
- inspect frontend/backend communication
- inspect Flow Admin orchestration
- inspect FlowPay orchestration
- inspect logs
- inspect retry systems
- inspect error handling
- inspect webhook handling
- inspect provider abstraction

Run:
- linting
- builds
- type checks
- migrations
- backend tests
- integration tests
- service boot tests
- environment validation
- health checks

Fix all discovered issues.

IMPORTANT: STOP focusing only on backend robustness. The backend architecture may be is already strong enough. heavily inspect, improve, and validate the FRONTEND and ADMIN EXPERIENCE of FlowPay in Flow Admin. 

This is NOT a backend-only system. This is an operational platform that humans must actively use every day. The frontend must feel production-grade, intelligent, modern, operational, clear, and trustworthy.

You must now perform a FULL FRONTEND AUDIT and FRONTEND COMPLETION PASS.

Focus heavily on:

- operational visibility
- management usability
- frontend workflows
- dashboard clarity
- admin experience
- setup experience
- onboarding flows
- status indicators
- observability
- control systems
- environment separation
- branding consistency
- mobile responsiveness
- empty states
- loading states
- error states
- success states
- setup guidance
- real operational flows
- frontend architecture quality
- UI/UX polish
- production-grade feel

CRITICAL:
Do NOT leave frontend pages as placeholders or backend-connected empty shells.

The frontend must expose and operationalize the backend capabilities properly.

You must inspect and validate ALL FlowPay frontend/admin areas including:

1. APP ONBOARDING UI
- create app integration
- generate credentials
- regenerate keys
- revoke credentials
- sandbox/live separation
- environment labels
- active status
- app health indicators
- integration instructions
- webhook configuration UI
- copy buttons
- secure credential masking
- credential rotation flows

2. FLOWPAY RULES & FEES UI
- platform fee setup
- percentage fee setup
- fixed fee setup
- transaction rules
- routing rules
- payout rules
- gateway priority logic
- fee previews
- live fee simulation
- rule validation
- rule conflict prevention
- human-readable explanations

3. SANDBOX VS LIVE EXPERIENCE
The frontend must CLEARLY distinguish:
- sandbox mode
- live mode
- testing mode
- production mode

Use:
- strong visual indicators
- badges
- banners
- labels
- warnings
- environment pills

Admins must NEVER confuse sandbox with production.

4. FLOWPAY BRANDING
FlowPay must feel like:
- a real fintech infrastructure platform
- trusted
- modern
- intelligent
- premium
- African-first
- enterprise-grade

Improve:
- branding consistency
- typography hierarchy
- fintech-style layouts
- transaction visualizations
- payment status design
- operational dashboard aesthetics
- bottom sheet branding consistency
- payment provider presentation

Do NOT expose internal gateway providers unnecessarily to end users.
Users should mostly see:
- MTN Mobile Money
- Orange Money
- Card
- Bank Transfer

NOT internal orchestration details.

5. DASHBOARDS
Improve and validate:
- metrics cards
- transaction monitoring
- app activity
- fee analytics
- environment monitoring
- gateway health
- webhook delivery monitoring
- payment success/failure rates
- app integration health
- active apps
- sandbox apps
- live apps
- recent activity

6. FRONTEND STATES
Ensure ALL pages have:
- loading states
- skeleton loaders
- empty states
- retry states
- graceful failures
- confirmation dialogs
- success toasts
- validation feedback
- smart form UX

7. RESPONSIVENESS
Validate:
- desktop
- tablet
- mobile
- narrow admin screens

No broken layouts.
No overflow issues.
No unusable tables.
No hidden controls.

8. OPERATIONAL EXPERIENCE
The platform must feel autonomous and smart.

Admins should feel:
- guided
- informed
- in control

NOT overwhelmed.

The frontend should explain complex systems simply.

9. TESTING
Run frontend-focused testing:
- navigation testing
- UI interaction testing
- responsive testing
- frontend integration testing
- setup flow testing
- environment switching testing
- onboarding testing
- credential management testing
- fee/rules workflow testing
- dashboard usability testing

10. FINAL VALIDATION
Before completion, ensure:
- frontend is not backend-dependent visually
- pages are not empty
- controls are functional
- UX feels production-grade
- frontend exposes backend power correctly
- operational flows are understandable
- FlowPay feels real and deployable

This must no longer feel like:
“a strong backend with a weak admin panel.”

It must feel like:
“A complete fintech infrastructure platform with enterprise-grade operational UX.”

====================================================

11. RESTRUCTURE IF NECESSARY
--------------------------------

If architecture is weak:
- restructure
- improve folder organization
- improve domain boundaries
- improve naming
- improve service isolation
- improve scalability
Very smartly and carefully if really necessary 

Do NOT preserve weak architecture for convenience.

====================================================

12. IMPORTANT FLOW PRINCIPLES
--------------------------------

Flow systems are:
- intelligent
- scalable
- modular
- production-ready
- future-proof
- operationally clean
- autonomous where appropriate
- configurable where necessary

Do NOT build demo architecture.
Do NOT build startup shortcuts.
Do NOT hardcode business rules.

Think like:
- Stripe
- Adyen
- Flutterwave
- modern orchestration platforms

But adapted for Flow ecosystem architecture.

====================================================
FINAL TASK
====================================================

After implementation/testing/refactoring:

Provide a documentation: 
- what was improved
- what was restructured
- what was fixed
- what remains configurable
- what is autonomous
- architecture overview
- environment overview
- onboarding flow explanation
- fee/rule engine explanation
- sandbox/live explanation
- security explanation
- production readiness report
- remaining recommendations

And confirm:
- system is stable
- production-ready structurally
- future-proof
- scalable
- modular
- properly separated
- operationally clean
- Flow-compliant
Use Playwright (headless mode) as your browser automation tool for UI testing. Treat it as your eyes and hands: open localhost, interact with the app flows, and take screenshots to verify UI states. Run tests in the background and only return concise results, issues found, and necessary fixes. Use it continuously for validating UI changes and debugging frontend behavior etc