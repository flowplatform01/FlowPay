# FlowPay – Advanced Range-Based Billing & Fee Rules

## Background

FlowPay already has a flexible billing and fee management system that supports:

- Flat fees
- Percentage fees
- Hybrid fee models
- Transaction billing configurations

The current implementation works well for standard scenarios and should remain fully supported.

This request is intended to extend the existing billing system, not replace it.

---

# Problem

Some transaction amounts are extremely small.

Examples:

- 1 XAF
- 5 XAF
- 25 XAF
- 100 XAF

Using only a standard percentage calculation may result in fees that are too small, economically impractical, or inconsistent with business requirements.

There should be an optional mechanism that allows administrators to define fee behavior for specific transaction ranges.

---

# Proposed Solution

Introduce an optional Advanced Billing Rules system.

This feature should be configurable and can be enabled or disabled per billing configuration.

When disabled:

- Existing billing behavior remains unchanged.
- Current fee calculations continue to operate exactly as they do today.

When enabled:

- Transaction amount ranges can define their own fee rules.

---

# Range-Based Fee Rules

Administrators should be able to create multiple amount ranges.

Example:

Range A

- Min Amount: 1 XAF
- Max Amount: 1,000 XAF
- Flat Fee: 50 XAF
- Percentage Fee: 0%

Range B

- Min Amount: 1,001 XAF
- Max Amount: 10,000 XAF
- Flat Fee: 100 XAF
- Percentage Fee: 1%

Range C

- Min Amount: 10,001 XAF
- Max Amount: 100,000 XAF
- Flat Fee: 250 XAF
- Percentage Fee: 0.5%

These values are examples only.

All values should be configurable.

---

# Rule Evaluation

When Advanced Billing Rules are enabled:

1. Determine the transaction amount.
2. Find the matching range.
3. Apply the fee configuration assigned to that range.
4. Calculate the final billing amount.

If no matching range exists:

System should either:

- Fall back to the standard billing configuration, or
- Follow an administrator-selected fallback strategy.

Implement the most maintainable and predictable approach.

---

# Range Management

Ranges should be:

- Ordered
- Non-overlapping
- Easy to understand
- Easy to maintain

The system should validate configurations and prevent invalid setups.

Examples of invalid configurations:

- Overlapping ranges
- Duplicate ranges
- Gaps where not allowed
- Negative values

---

# Administrative Controls

Add management tools within the Admin Application.

Administrators should be able to:

- Enable/disable advanced billing
- Create ranges
- Edit ranges
- Reorder ranges if necessary
- Delete ranges
- Configure fallback behavior
- Preview fee calculations

---

# Fee Models Per Range

Each range should support:

- Flat fee only
- Percentage only
- Hybrid (flat + percentage)
- Future billing models

Do not hardcode a single fee calculation strategy.

Reuse the existing billing architecture wherever possible.

---

# Calculation Transparency

Where applicable, transaction previews and billing breakdowns should clearly indicate:

- Transaction amount
- Matching range
- Applied rule
- Flat fee
- Percentage fee
- Final fee
- Final settlement amount

This improves transparency and reduces support issues.

---

# Architecture Expectations

Do not create a completely separate billing engine.

Extend the existing billing system in a clean and scalable way.

The advanced range rules should act as an optional layer on top of the current billing architecture.

Avoid duplication of logic.

Reuse existing fee calculators wherever possible.

---

# Future Scalability

Design this as a generic rule-based pricing engine that can later support:

- Different transaction types
- Different payment methods
- Different currencies
- Different merchant tiers
- Different customer categories
- Promotional pricing
- Dynamic billing rules

The goal is to make FlowPay's billing system production-grade and flexible enough to support future business requirements without requiring major redesigns.