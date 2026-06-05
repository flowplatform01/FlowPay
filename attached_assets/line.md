FLOWPAY – CREDIT AUTOMATION, DEVELOPER SELF-SERVICE, RECIPIENT GOVERNANCE & CHECKOUT IMPLEMENTATION PHASE

PHOSE 0 - brief Implementation Phase

You have already reviewed and understood Brief.md. Do not treat that document as a discussion document anymore. Treat it as an approved architectural direction.

Proceed as a smart autonomous implementation agent that u are.



────────────────────────────


Additionally:

PART 1 — CREDIT SYSTEM EVOLUTION

Current state:

Credit allocation is currently admin-driven and primarily manual.

This must evolve into a hybrid model.

Required outcome:

FlowPay must support BOTH:

A. Manual Admin Credit Allocation

Existing capability remains.
Admin can still manually grant, adjust, or manage credits.

B. Real Credit Purchase / Top-Up

Developer or tenant can purchase credits directly.
Credits become a prepaid operational balance.
Real payment results in real credit increase.
FlowPay processes the payment through its normal payment infrastructure.
Successful settlement automatically updates the developer credit balance.

Design and implement the most production-ready architecture for this workflow.

Do not force unnecessary admin intervention for normal credit acquisition.

Admin oversight remains available, but normal top-up should become self-service.

────────────────────────────

PART 2 — DEVELOPER SELF-SERVICE CREDIT OPERATIONS

Evaluate and implement a secure developer-facing capability for:

Credit balance retrieval.
Credit usage visibility.
Credit purchase initiation.
Credit top-up completion.
Credit transaction history.

The developer should not need to contact an admin for routine balance operations.

Design the API, governance model, security controls, limits, auditing, and operational safeguards according to FlowPay standards.

────────────────────────────

PART 3 — RECIPIENT SETUP GOVERNANCE REVIEW

Review the existing Save Recipient / Destination Setup capability.

Current concern:

The current flow appears too backend-driven.

An external application can submit recipient configuration data, but the final owner of the destination should have visibility and confirmation over what is being saved.

Review whether the current implementation sufficiently protects against:

Wrong destination configuration.
Silent destination replacement.
Misconfigured payout targets.
Human mistakes.
External application abuse.

If improvements are required:

Design and implement a recipient-confirmation experience that remains consistent with FlowPay separation of concerns.

Important:

FlowPay must not become aware of school logic, merchant logic, tenant logic, or application business logic.

FlowPay only governs payment destinations and payment safety.

Maintain that boundary.

────────────────────────────

PART 4 — CHECKOUT-DRIVEN CONFIRMATION EXPERIENCE

Review whether recipient setup operations should pass through a FlowPay-controlled confirmation experience similar to checkout.

Goal:

Before a destination is finalized:

The user sees exactly what is being registered.
The user can review details.
The user can approve.
The user can reject.
The user can correct mistakes when appropriate.

This should not expose internal orchestration logic.

This should not expose providers.

This should not expose infrastructure details.

Only expose information required for safe user confirmation.

Implement only if it genuinely improves safety, governance, and production readiness.

────────────────────────────
PART 5 — CREDIT TOP-UP UX

Review whether credit purchase should leverage:

Existing checkout infrastructure.
    OR
A specialized developer credit checkout experience.

Determine the best architecture.

Requirements:

View current credit balance.
View resulting balance after purchase.
Initiate payment.
Confirm purchase.
Receive successful credit allocation.

The experience must remain consistent with FlowPay design principles.

────────────────────────────

PART 6 — PRODUCTION VALIDATION

After implementation:

Execute real validation scenarios.
Execute developer scenarios.
Execute merchant scenarios.
Execute recipient setup scenarios.
Execute credit purchase scenarios.
Execute misuse scenarios.
Execute security scenarios.

Verify that:

Separation of concerns remains intact.
No provider leakage occurs.
No orchestration leakage occurs.
No internal infrastructure is exposed.
No admin dependency exists where automation should exist.
Credit operations remain auditable.
Recipient operations remain safe.

Deliver implementation, testing, fixes, refinements, and final production-ready behavior.

Do not stop at analysis.

Implement, validate, refine, and complete the work.
