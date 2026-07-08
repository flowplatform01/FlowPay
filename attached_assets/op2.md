# FlowPay – Recipient Capacity & Credit Eligibility System

## Background

The current Recipient Setup feature allows tenant applications to create recipient records and send them through the FlowPay confirmation process.

The platform already supports administrative recipient limits.

Examples:

- Maximum 5 recipients
- Maximum 100 recipients
- Maximum 500 recipients
- Unlimited recipients

However, recipient limits alone are insufficient.

A tenant may have permission to create recipients but may have little or no FlowPay credit available to actually operate those recipients.

This creates poor UX because recipient creation succeeds while future operations fail due to insufficient credit.

---

# New Requirement

Introduce a Credit Eligibility Layer for Recipient Capacity.

Recipient capacity should depend on BOTH:

1. Administrative permissions
2. Available FlowPay credit

A tenant must satisfy both conditions.

---

# Core Principle

Recipient capacity should represent realistic operational capacity.

It should not be possible for an application to accumulate large numbers of recipients if it lacks sufficient credit to support the operations associated with those recipients.

---

# Capacity Tiers

Introduce configurable recipient capacity tiers.

Example structure:

Tier 1

- Up to 1 recipient
- Requires minimum credit threshold

Tier 2

- Up to 5 recipients
- Requires higher credit threshold

Tier 3

- Up to 20 recipients
- Requires higher credit threshold

Tier 4

- Up to 100 recipients
- Requires higher credit threshold

Tier 5

- Unlimited recipients
- Requires platform-defined threshold

These values are examples only.

All thresholds must be configurable.

---

# Validation Rules

Before a recipient can be activated:

System checks:

1. Recipient limit permissions
2. Credit eligibility requirements
3. Account status
4. Any future platform policies

If requirements fail:

Recipient activation must be blocked.

Display a clear explanation to the tenant.

Examples:

- Insufficient FlowPay credit
- Recipient capacity exceeded
- Upgrade required
- Administrative restriction

---

# Recipient Confirmation Integration

During the final FlowPay confirmation process:

Additional validation must occur.

Before confirmation:

Check whether the tenant still satisfies:

- Recipient capacity requirements
- Credit eligibility requirements

If eligibility changed after the setup began:

Prevent activation.

Require the tenant to meet the requirements first.

---

# Credit Top-Up Integration

Recipient capacity should react automatically to credit changes.

Examples:

If credit increases:

- Additional recipient capacity becomes available.

If credit decreases:

- Existing recipients remain active.
- New recipient creation may be restricted.

Never automatically deactivate existing recipients solely because credit drops below a threshold.

Only restrict future growth.

---

# Administrative Controls

Add full management controls to the FlowPay Admin Application.

Administrators should be able to manage:

## Capacity Tiers

- Tier name
- Tier description
- Maximum recipients

## Credit Requirements

- Minimum credit threshold
- Credit calculation method
- Credit multiplier rules

## Restrictions

- Enable/disable enforcement
- Enable/disable specific tiers
- Allow unlimited tier

## Exceptions

- Grant manual overrides
- Grant custom recipient limits
- Grant custom credit requirements

---

# Default Platform Configuration

Provide sensible default values.

The platform should function immediately after deployment without requiring configuration.

Administrators may later customize all thresholds.

---

# Future Scalability

Design this as a reusable policy engine.

The same mechanism should later support:

- Recipient capacity
- Virtual account capacity
- API usage capacity
- Checkout volume limits
- Merchant scaling tiers
- Future FlowPay resource controls

Do not hardcode logic specifically for recipients.

Build a generalized Capacity & Eligibility Policy System.

---

# Expected Benefits

- More mature platform governance
- Better resource management
- Improved platform economics
- Reduced abuse
- Better scaling model
- Better operational predictability
- Improved production readiness

This feature should be integrated into D Mode and all future confirmation-based workflows where applicable.