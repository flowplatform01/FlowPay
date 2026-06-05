
Feedback on the Proposed Production Credit Formula

After reviewing the proposed production credit model, I do not think FlowPay should adopt a highly granular credit calculation system where every operation consumes credits based on numerous backend factors such as provider routing costs, operational costs, status tracking costs, webhook delivery costs, receipt generation costs, payout coordination costs, risk review costs, and similar variables.

While this may appear theoretically accurate, it introduces significant complexity, unnecessary calculations, and additional backend processing for every transaction. At this stage, I do not believe such a model provides enough practical value to justify its complexity.

The primary purpose of the credit system is not to become a second billing engine. FlowPay already has a fee and billing structure that determines the platform’s revenue model. The credit system should simply mirror or reflect that existing billing logic rather than attempting to independently calculate operational costs.

Preferred Approach

Instead of assigning arbitrary credits per action, the credit deduction should be directly linked to the fee that would normally be charged for the transaction.

For example:

If FlowPay’s billing model charges a 3% fee on a transaction, then the equivalent value should be deducted from the tenant’s preloaded credit balance.
The credit consumed should represent the fee that FlowPay would normally have collected.
This keeps the credit system simple, predictable, and aligned with existing billing rules.

Why This Is Important

A flat credit-per-transaction model creates unfair economics.

For example:

A transaction of 10,000 FCFA should not consume the same credits as a transaction of 1,000,000 FCFA.
Doing so would create losses and would not accurately reflect the value being processed.

The credit consumption should therefore scale according to the transaction value, using the same percentage-based logic already defined in FlowPay’s billing system.

The Real Purpose of Credits

The credit system becomes especially important in non-custodial and peer-to-peer scenarios.

In these cases:

Funds move directly between the payer and the recipient.
FlowPay may not be able to automatically deduct its normal transaction fee.
This is particularly relevant when integrating external payment gateways or direct peer-to-peer payment providers.

In such situations, credits act as FlowPay’s compensation mechanism.

Rather than charging the end user directly, the application owner or tenant maintains a credit balance. As transactions occur, credits are deducted according to the equivalent fee that would normally have been charged.

This allows:

True peer-to-peer fund movement.
No direct intervention in customer funds.
No disruption to the user experience.
A sustainable revenue model for FlowPay.

Tenant Flexibility

The tenant remains responsible for deciding how to recover these costs from their own customers.

For example, they may:

Absorb the cost themselves.
Add a service fee.
Increase invoice amounts.
Include the cost in their pricing structure.

This decision belongs to the tenant, not FlowPay.

FlowPay’s responsibility is simply to deduct the appropriate credit amount from the tenant’s balance based on the platform’s existing fee structure.

Conclusion

The objective of the credit system is not to model every operational cost or create a complex pricing engine. Its purpose is to provide a simple mechanism that mirrors FlowPay’s existing billing percentages, especially in non-custodial and peer-to-peer transaction scenarios where normal fee collection is not possible.
Therefore, credit consumption should be tied directly to the fee amount that FlowPay would normally charge rather than being calculated through a separate operational-cost formula.