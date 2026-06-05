You are working on the Flow Admin platform and its FlowPay management domain.

IMPORTANT:
This is NOT a toy dashboard project, not a UI-only redesign task, and not a generic analytics/admin panel. This is production-grade internal financial infrastructure management software.

You must deeply study the existing architecture, codebase, modular structure, routing structure, domain structure, backend communication flow, current FlowPay implementation, and all existing operational logic BEFORE making changes.

Do NOT blindly rewrite or destroy architecture already working well.
Do NOT overengineer unnecessarily.
Do NOT create fake fintech complexity.
Do NOT duplicate responsibilities already handled by payment providers.

You must improve the system intelligently, production-safely, modularly, and operationally.

━━━━━━━━━━━━━━━━━━━
CORE ARCHITECTURE CONTEXT
━━━━━━━━━━━━━━━━━━━

FlowPay is NOT:
- a bank
- a telecom processor
- a wallet network
- a raw payment rail

FlowPay IS:
- a centralized payment orchestration and transaction infrastructure layer for the Flow ecosystem.

FlowPay integrates with providers like:
- CinetPay
- Campay
- Maviance

Those providers already handle:
- telecom integrations
- raw payment execution
- settlement rails
- low-level payment processing

Therefore:
FlowPay focuses on:
- orchestration
- transaction lifecycle management
- provider abstraction
- fee management
- settlement oversight
- reconciliation
- app integrations
- API infrastructure
- billing logic
- event orchestration
- ecosystem-wide payment governance

━━━━━━━━━━━━━━━━━━━
VERY IMPORTANT SYSTEM RELATIONSHIP
━━━━━━━━━━━━━━━━━━━

The Flow Admin app is the management/governance surface controlling FlowPay infrastructure.

Architecture relationship:

Flow Admin Frontend
↓
Flow Admin Backend
↓
FlowPay Infrastructure
↓
External Payment Providers

Meaning:
- FlowPay itself behaves more like infrastructure/backend services
- Flow Admin is the operational and management layer for controlling it

DO NOT break this architecture.

━━━━━━━━━━━━━━━━━━━
MAIN PROBLEM TO SOLVE
━━━━━━━━━━━━━━━━━━━

The current implementation already contains operational monitoring, transactions, gateway visibility, metrics, and many operational features.

HOWEVER:
the system still behaves more like:
- a monitoring dashboard
instead of:
- a true managed payment platform.

The biggest missing piece is:
PLATFORM MANAGEMENT ARCHITECTURE.

The goal is NOT to simply add more analytics or cards.

The goal is to evolve FlowPay management into:
- a scalable
- modular
- operational
- production-grade
- governance-oriented
payment infrastructure management platform.

━━━━━━━━━━━━━━━━━━━
MAIN OBJECTIVE
━━━━━━━━━━━━━━━━━━━

Deeply improve:
- FlowPay management architecture
- operational organization
- separation of concerns
- management capabilities
- platform governance structure
- developer integration workflows
- entity/resource management
- UX workflows
- operational intelligence
- billing management
- application onboarding
- provider management
- permissions/configuration systems

WITHOUT:
- destroying existing modular architecture
- breaking backend contracts
- making the UX bloated
- introducing unnecessary fintech complexity

━━━━━━━━━━━━━━━━━━━
VERY IMPORTANT DESIGN PRINCIPLE
━━━━━━━━━━━━━━━━━━━

The system must feel like:
- infrastructure software
- operational platform software
- internal developer/payment platform

NOT:
- a static admin template
- a simple analytics dashboard
- a generic CRUD system

The UX must prioritize:
- operational clarity
- contextual workflows
- management actions
- scalability
- maintainability
- governance
- intelligent hierarchy
- production-readiness

━━━━━━━━━━━━━━━━━━━
CRITICAL MANAGEMENT CONCEPTS TO IMPLEMENT/REFINE
━━━━━━━━━━━━━━━━━━━

You must deeply think through and intelligently improve all management capabilities related to FlowPay.

This includes (but is not limited to):

1. Application Management
- create Flow-integrated applications
- register apps into FlowPay
- manage application lifecycle
- revoke/suspend/archive apps
- manage environments
- manage app scopes/capabilities
- configure app-level permissions
- enable/disable payment capabilities
- generate/revoke/rotate API credentials
- manage webhooks/events
- manage provider access per app

2. Provider & Integration Management
- provider abstraction management
- provider health visibility
- provider capability configuration
- routing configuration
- provider failover readiness
- sandbox/live separation
- webhook configuration
- API secret management

3. Organization Management
- schools/business entities
- settlement profiles
- billing relationships
- enabled providers
- transaction permissions
- payout configuration
- verification/compliance states
- operational controls

4. Billing & Fee Management
VERY IMPORTANT

FlowPay itself must support:
- platform billing logic
- fee orchestration
- billing configuration
- percentage/fixed fee structures
- app-level pricing logic
- school/platform billing rules
- monetization configuration
- subscriptions where relevant
- payment product configurations
- invoice/billing structures where required

Think deeply and production-wise here.

5. Transaction Governance
- lifecycle management
- retries
- reconciliation
- settlement oversight
- auditability
- operational interventions
- refund/reversal workflows where needed
- event tracing
- transaction intelligence

6. Operational Infrastructure
- queues
- retries
- failed jobs
- event orchestration
- webhook reliability
- reconciliation operations
- operational incidents
- retry centers
- dead-letter handling
- operational tooling

7. Developer Platform Features
- API management
- integration onboarding
- credentials
- SDK-related tooling where needed
- event subscriptions
- environment management
- webhook testing
- developer-focused operational clarity

8. Security & Governance
- audit logs
- permissions
- role-aware management
- secret handling
- operational accountability
- activity tracking
- policy management

━━━━━━━━━━━━━━━━━━━
IMPORTANT UX/UI INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━

Do NOT redesign blindly.

You must:
- study the current UI structure carefully
- preserve good existing architecture
- preserve existing modular patterns where intelligent
- improve hierarchy and operational workflows
- improve management discoverability
- improve navigation organization
- improve separation of concerns
- improve contextual drilldowns
- improve scalability of the interface

The goal is NOT “more beautiful cards”.

The goal is:
- operational UX maturity
- management clarity
- platform governance usability
- production operational workflows

The UI/UX must feel:
- modern
- operational
- scalable
- responsive
- intelligent
- production-grade
- highly usable under real operational load

Avoid:
- clutter
- fake enterprise complexity
- unnecessary animations
- shallow dashboards
- overengineered navigation

━━━━━━━━━━━━━━━━━━━
VERY IMPORTANT ENGINEERING INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━

You must:
- deeply inspect the existing codebase
- understand current module boundaries
- understand routing structure
- understand current state management
- understand backend contracts
- understand existing entities/resources
- understand current operational flows

Then:
- improve intelligently
- refactor carefully
- preserve stability
- avoid regressions

Do NOT:
- create disconnected systems
- break modularity
- introduce duplicate logic
- bypass architecture conventions
- hardcode operational logic
- create shallow/static management features

━━━━━━━━━━━━━━━━━━━
AUTONOMY & INTELLIGENCE
━━━━━━━━━━━━━━━━━━━

You must think deeply and autonomously.

Do NOT only implement explicitly written items.

You must:
- identify architectural weaknesses
- identify UX weaknesses
- identify missing management concepts
- identify missing operational workflows
- identify missing governance structures
- identify scalability risks
- identify maintainability problems

Then improve them intelligently while respecting existing architecture.

Think like:
- a senior infrastructure engineer
- a senior platform engineer
- a senior fintech systems architect
- a senior operational UX engineer

━━━━━━━━━━━━━━━━━━━
TESTING & QUALITY REQUIREMENTS
━━━━━━━━━━━━━━━━━━━

VERY IMPORTANT:
Everything added, changed, or refactored must be:
- fully tested
- operationally validated
- production-safe
- type-safe
- resilient
- scalable

You must:
- test flows deeply
- validate integrations
- validate state transitions
- validate management workflows
- validate edge cases
- validate operational behavior
- validate UI states
- validate permissions
- validate responsiveness
- validate loading/error states

Do NOT leave:
- fake/static flows
- incomplete workflows
- broken interactions
- shallow implementations
- placeholder logic
- inconsistent states

Ensure:
- excellent UX
- excellent operational clarity
- production readiness
- maintainability
- clean architecture
- scalable management structure

Final goal:
Transform FlowPay management inside the Flow Admin platform into a true production-grade payment infrastructure management and governance platform while preserving architectural integrity and improving operational maturity intelligently.