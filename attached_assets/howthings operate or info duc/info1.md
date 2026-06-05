Here is the real current External Test App checkout model.

Main Handshake
For every checkout type, the flow is:

Browser submits the form to the External Test App backend: POST /api/payments/initialize.
External Test App backend uses stored FlowPay app credentials, not browser credentials.
It calls FlowPay API: POST /api/v1/payments/initialize.
FlowPay validates app keys, idempotency key, amount, customer, payment method, tenant/recipient rules.
FlowPay creates the transaction and returns a hosted checkout URL + session token.
External Test App opens the FlowPay Checkout iframe/bottom sheet.
Checkout loads the session with token.
Customer authorizes payment.
Checkout calls FlowPay confirmation endpoint.
FlowPay talks to the provider internally.
Provider/webhook/reconciliation updates transaction state.
Checkout receives live status through SSE, with polling fallback.
Checkout sends final result back to External Test App using iframe postMessage.
FlowPay also sends merchant webhook to the app’s webhook URL.
1. Online Store Order
Purpose: normal merchant checkout.

Real scenario: A customer buys something from an online shop.

Mode: MODE_1, platform/merchant collection.

What happens:

Customer pays the merchant/app.
No saved recipient is involved.
Money is collected for the app/tenant’s normal payment flow.
FlowPay handles provider routing internally.
Checkout shows payment success/failure to customer.
How to test:

Select Online Store Order.
Use your real number in Customer Phone.
Choose MTN Mobile Money if you want a real phone prompt.
Enter amount.
Open checkout and confirm on phone.
2. Subscription Invoice
Purpose: invoice-style payment.

Real scenario: A SaaS user pays a monthly subscription invoice.

Mode: MODE_1.

What happens:

It is still a one-time payment in this test app.
It is not a recurring subscription engine.
The difference is business meaning: invoice/subscription payment instead of store order.
FlowPay treats it as a normal merchant collection.
How to test:

Select Subscription Invoice.
If you want real phone prompt, change payment method to MTN Mobile Money.
Use your real phone number.
Confirm on phone.
3. Saved Recipient Transfer
Purpose: tenant-routed payment to a saved destination.

Real scenario: Campus app is the FlowPay tenant, and a school is a saved recipient/destination profile. Parent pays through Campus; FlowPay knows which school should receive settlement.

Mode: MODE_2.

What happens:

Customer/payer pays first.
FlowPay validates Saved Recipient ID.
FlowPay finds that recipient’s destination profile.
FlowPay collects the payment.
After successful collection, FlowPay creates/executes payout coordination toward the saved recipient target.
If provider payout is supported/configured, payout is attempted.
If payout cannot execute, it appears in Admin → Operations → Payout Coordination.
Important: the payer phone and saved recipient target are different concepts. If both are your number, then you pay from your number and later payout may also go back to that same number, but only if Mode 2 payout executes.

How to test:

Select Saved Recipient Transfer.
Use a valid Saved Recipient ID, for example my-real-test or panama-mode2-recipient, depending on what exists and is verified.
Use your real phone in Customer Phone.
Choose MTN/Orange depending on the rail you want.
Confirm on phone.
Then check Admin → FlowPay → Operations → Payout Coordination.
4. Declined Payment Test
Purpose: controlled failure test.

Real scenario: customer card/payment is declined.

Mode: MODE_1.

What happens:

This is intentionally locked to a failure scenario.
It should not be used for real MTN phone confirmation.
It tests failure UI, failed transaction state, webhook behavior, and merchant handling.
How to test:

Select Declined Payment Test.
Do not expect real mobile money prompt.
Open checkout.
It should end as failed/declined.
5. Custom Merchant Payment
Purpose: manual flexible test.

Real scenario: a developer wants to test a custom order, invoice, transfer, school fee, wallet top-up, etc.

Mode depends on the form:

If no Saved Recipient ID is provided: MODE_1.
If Saved Recipient ID is provided: MODE_2.
What happens:

Without saved recipient: app/tenant receives collection.
With saved recipient: FlowPay routes to the destination profile and may coordinate payout.
This is the most flexible option, but also easiest to misunderstand.
How to test as normal merchant collection:

Select Custom Merchant Payment.
Leave Saved Recipient ID empty.
Use your real number.
Choose MTN Mobile Money.
Confirm on phone.
How to test saved-recipient payout:

Select Custom Merchant Payment.
Enter my-real-test in Saved Recipient ID.
Use your real number in Customer Phone.
Confirm on phone.
Then check Admin payout coordination.
6. Unknown Recipient Test
Purpose: negative Mode 2 validation.

Real scenario: an app tries to pay a school/vendor recipient that does not exist or is not verified.

Mode: MODE_2.

What happens:

FlowPay rejects initialization.
No real payment should be created.
It proves FlowPay does not silently fallback to normal merchant collection when recipient routing is invalid.
How to test:

Use scenario card if visible.
It should fail before checkout opens.
Simple Meaning

Online Store Order: customer pays merchant.
Subscription Invoice: customer pays invoice/subscription.
Saved Recipient Transfer: customer pays, then FlowPay settles to a saved recipient.
Declined Payment Test: controlled failure.
Custom Merchant Payment: manual Mode 1 or Mode 2 depending on Saved Recipient ID.
Unknown Recipient Test: invalid recipient safety test.