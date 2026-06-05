You are a senior fintech systems architect and elite full-stack engineer. 

Your task is to FULLY DESIGN AND BUILD the first production-grade version of “FlowPay” for the company “Flow”.

IMPORTANT:
This is NOT a demo project.
This is NOT a toy payment gateway.
This is NOT just a payment form.

FlowPay is the central payment orchestration and transaction infrastructure for the entire Flow ecosystem.

The system must be:
- Future-proof
- Modular
- Scalable
- Secure
- Multi-tenant
- Event-driven
- API-first
- Cleanly architected
- Production-ready in structure
- Ready for future integrations
- Ready for future apps
- Ready for future scaling

====================================================
COMPANY CONTEXT
====================================================

Company Name: Flow

Flow is a smart African technology ecosystem with multiple divisions and apps.

Current major apps/divisions include:

1. Campus
   - School management platform
   - Multi-school architecture
   - Students, parents, teachers, admins
   - Fees, billing, notifications, academic systems
   - Uses FlowPay for all payment orchestration

2. FlowMoney
   - Fintech app
   - Wallets
   - Savings
   - Budgeting
   - Loans
   - Tontine/Jangi management
   - Internal transfers
   - Uses FlowPay infrastructure

3. FlowShop
   - Marketplace platform
   - Verified sellers only
   - Product-based marketplace
   - Uses FlowPay

4. Logistics & Mobility division
   - Delivery and logistics
   - Uses FlowPay

5. FlowAI
   - AI orchestration infrastructure
   - Internal AI service layer
   - Future AI APIs and automation

6. Telecom & Networking division
   - School networking infrastructure
   - ISP orchestration in future
   - Internet/network deployment support
   - Future integrations with Flow ecosystem

====================================================
MAIN GOAL OF FLOWPAY
====================================================

FlowPay is NOT a wallet app.

FlowPay is:
- A payment orchestration layer
- A payment infrastructure service
- A secure transaction processor
- A unified payment API
- A multi-gateway router
- A transaction and settlement engine
- A payment abstraction layer for all Flow apps

FlowPay must:
- Accept payment requests from apps
- Process payments securely
- Route payments to the correct payment gateway
- Handle transaction orchestration
- Handle settlement logic
- Handle fee calculations
- Handle transaction metadata
- Handle payment events
- Handle webhooks
- Handle transaction states
- Handle retries
- Handle gateway failover in future
- Handle audit logs
- Handle future scaling

====================================================
VERY IMPORTANT ARCHITECTURE RULES
====================================================

FlowPay is a SEPARATE backend service.

FlowPay is NOT embedded directly into Campus or other apps.

Architecture:

Apps (Campus, FlowMoney, FlowShop, etc)
        ↓
FlowPay API Layer
        ↓
Gateway Providers
(CamPay, Maviance, CinetPay)

The apps communicate directly with FlowPay.

FlowPay communicates with gateways.

Apps NEVER communicate directly with gateways.

====================================================
CURRENT GATEWAYS TO SUPPORT
====================================================

Implement adapters/providers for:

1. CamPay
2. Maviance
3. CinetPay

The architecture MUST allow future addition of:
- MTN MoMo APIs
- Orange Money APIs
- Stripe
- PayPal
- Flutterwave
- Paystack
- Bank APIs
- Crypto in future if needed

Use provider adapter architecture.

====================================================
VERY IMPORTANT PAYMENT MODEL
====================================================

FlowPay does NOT own school money.

The apps own the business logic.

Example:
Campus calculates school fees.

FlowPay ONLY processes and orchestrates payment.

Meaning:
- Campus tells FlowPay what amount should be paid
- FlowPay handles payment processing
- Money goes directly to school account/wallet/bank configured by school
- FlowPay only takes processing/platform fee
====================================================
FEE SYSTEM
====================================================

Implement:
- Flat fee support
- Percentage fee support
- Hybrid fee support
- Dynamic fee support

VERY IMPORTANT:
FlowPay fee is ADDITIONAL to the transaction amount.

Example:
School fee = 100,000 FCFA

FlowPay may add:
- Gateway processing fee
- Flow platform fee

User may finally pay:
102,500 FCFA

FlowPay must:
- Calculate fees cleanly
- Separate fee components
- Store fee breakdown
- Store settlement breakdown

====================================================
SETTLEMENT SYSTEM
====================================================

FlowPay must support:
- Direct payout to recipient
- Split logic architecture
- Future escrow support
- Settlement tracking
- Settlement states

Store:
- gross amount
- net amount
- gateway fee
- platform fee
- settlement amount
- settlement destination

====================================================
PUBLIC API SYSTEM
====================================================

DO NOT rely on one Render URL exposed publicly.

Implement:
- API Keys
- Public keys
- Secret keys
- Client IDs
- Client secrets

Apps must authenticate using:
- App credentials
- Signed requests
- Secure API communication

Each app (Campus, FlowMoney, etc) must register with FlowPay.

Each app gets:
- public_key
- secret_key
- webhook_secret
- app_id

====================================================
BOTTOM SHEET / CHECKOUT SDK
====================================================

FlowPay must provide:
- Embedded payment experience
- Reusable checkout flow
- Branded FlowPay payment bottom sheet

Build:
- Payment UI SDK architecture
- Future embeddable frontend package architecture
- Standard checkout flow

The checkout flow should:
- Allow gateway selection
- Show fees transparently
- Handle secure confirmation
- Return transaction result securely

Architecture should support:
- React package in future
- Flutter package in future
- Mobile SDKs in future

====================================================
FLOWPAY ADMIN MANAGEMENT
====================================================

FlowPay backend is separate.

BUT:
Management UI lives inside Flow Admin App.

Inside the existing Flow Admin platform:
Create a FULL FlowPay Management in the section/Module you quite already setup .

====================================================
FLOWPAY ADMIN FEATURES
====================================================

Implement admin dashboards for:

1. Transaction Monitoring
2. Gateway Monitoring
3. Fee Monitoring
4. App Integrations
5. API Key Management
6. Settlement Monitoring
7. Webhook Logs
8. Failed Transactions
9. Retry Queue
10. Audit Logs
11. App Registrations
12. Platform Revenue Analytics
13. Gateway Health Status
14. Payment Analytics
15. Transaction Search
16. Refund Architecture Placeholder
17. Manual Review Queue
18. Suspicious Activity Queue
19. Webhook Replay System
20. API Usage Monitoring

====================================================
TECH STACK REQUIREMENTS
====================================================

Frontend:
- Next.js latest
- TypeScript
- App Router
- TailwindCSS
- Shadcn UI
- Clean enterprise UI
- Responsive
- Dark mode ready
- Modern fintech dashboard UX

Backend:
- Node.js
- TypeScript
- Express or Fastify (choose best architecture)
- Modular architecture
- Service-based architecture

Database:
- PostgreSQL (Neon)

ORM:
- Prisma

Caching:
- Redis

Queues:
- BullMQ

Validation:
- Zod

Auth:
- JWT
- RBAC
- Secure session handling

Logging:
- Winston or Pino

API Docs:
- Swagger/OpenAPI

====================================================
DATABASE REQUIREMENTS
====================================================

Design proper schemas for:
- apps
- api_keys
- transactions
- transaction_events
- payment_attempts
- settlements
- webhook_logs
- gateway_configs
- gateway_health
- audit_logs
- fee_rules
- organizations
- payout_destinations
- retry_jobs
- admin_users
- permissions

Include:
- indexes
- relationships
- auditability
- timestamps
- soft deletes where needed

====================================================
SECURITY REQUIREMENTS
====================================================

Implement:
- Rate limiting
- API authentication
- RBAC
- Audit logs
- Secure webhook verification
- Request signing
- Input validation
- Transaction idempotency
- Replay attack prevention
- Secure secret storage architecture
- Environment separation
- IP tracking
- Admin action logs

====================================================
SCALABILITY REQUIREMENTS
====================================================

Architecture MUST support:
- Multiple Flow apps
- Thousands of schools
- Millions of transactions
- Multi-region in future
- Microservice migration in future
- Event-driven scaling in future

====================================================
VERY IMPORTANT DEVELOPMENT REQUIREMENTS
====================================================

DO NOT generate fake architecture.

DO NOT build shallow demo code.

DO NOT build simplistic CRUD only.

Build:
- Proper folders
- Proper modules
- Proper abstractions
- Proper services
- Proper architecture
- Clean enterprise structure

====================================================
PROJECT STRUCTURE
====================================================

Create:

1. FlowPay backend service
2. FlowPay integration SDK architecture
3. FlowPay admin module inside Flow Admin app
4. Database schemas
5. Queue system
6. Redis integration
7. Gateway adapter architecture
8. Event system
9. Webhook system
10. Transaction orchestration engine

====================================================
DELIVERABLES
====================================================

Generate:
- Full project structure
- Backend architecture
- Frontend admin module
- Database schema
- Prisma schema
- API routes
- Queue setup
- Redis setup
- Gateway abstraction layer
- Transaction orchestration logic
- Fee engine
- Settlement engine architecture
- RBAC
- Environment setup
- Docker setup if useful
- README
- Setup instructions
- Clean comments
- Production-oriented architecture

====================================================
IMPORTANT UX REQUIREMENTS
====================================================

The admin dashboard must feel:
- Premium
- Enterprise-grade
- Clean
- Powerful
- Not cluttered
- Modern fintech level
- Similar quality level to Stripe Dashboard concepts

====================================================
ENVIRONMENT VARIABLES
====================================================

Prepare .env.example properly for flowpay.

Expected variables:
- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- CAMPAY keys
- MAVIANCE keys
- CINETPAY keys
- WEBHOOK secrets
- APP secrets
- Encryption secrets

====================================================
FINAL INSTRUCTION
====================================================

Build this like a real African fintech infrastructure startup preparing for serious scale.

The codebase must be:
- Clean
- Smart
- Modular
- Enterprise-grade
- Future-proof
- Easy to extend
- Easy to maintain

DO NOT cut corners.

Think deeply before generating architecture.

Generate everything carefully and professionally.