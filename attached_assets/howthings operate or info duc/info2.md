does ral peer-to-peer realy exist am saying even fee/percent cant touch it?
9:40 PM
Yes, real peer-to-peer can exist, but the meaning depends on the payment rail/provider.

In strict terms, true peer-to-peer means:

payer wallet/account -> recipient wallet/account
FlowPay does not receive, hold, settle, or custody the money.

In that model, FlowPay cannot naturally “take a percentage” from the money unless the underlying provider/rail supports one of these:

native split payment
platform fee/commission field
merchant fee deduction
separate debit/charge
recipient-paid fee
wallet/provider-side fee sharing
If the rail does not support those, then yes: FlowPay cannot touch the money percentage directly without becoming part of the money flow.

That is exactly where credits make sense.

Example:

Parent pays School directly:
Parent MTN wallet -> School MTN wallet
FlowPay only validates school, creates payment instruction, tracks status, reconciles webhook.
In that case:

FlowPay does not deduct 2% from the payment.
School receives full amount, except provider’s own fee if any.
Campus app consumes FlowPay credits for using orchestration.
Campus may separately bill schools/platform users outside that payment.
So:

Peer-to-peer money flow = provider rail handles money
FlowPay credit flow = app pays FlowPay for infrastructure
But in your current CamPay Mode 2 flow, it is not pure peer-to-peer yet. It is closer to:

payer -> CamPay/merchant collection -> payout coordination -> recipient
That is two-step mirror settlement, not pure P2P.

Pure P2P would require provider support for direct wallet-to-wallet / recipient-directed collection where FlowPay can specify the recipient as the actual money destination at payment time. In that case, FlowPay should mainly charge credits, not payment percentage.

9:40 PM
i dint meen deduction for we are always on fee as add on righ? i even mean currently due to that add on fee does real peer-to-peer realy exist. dont investigate/study and not just gues oo
9:49 PM

Worked for 6m 54s
I checked the actual code, not just the prompt/spec.

Short answer: real pure peer-to-peer does not fully exist in the active FlowPay implementation today. What exists today is Mode 2 recipient routing with payout coordination, mainly TWO_STEP_MIRROR.

Yes, fees are currently handled as an add-on:

base amount = what the recipient should receive
platform fee + gateway fee = added on top
customer pays grossAmount = base + fees
That is in fees.service.ts (line 25). Settlement keeps the recipient amount as the base amount in settlements.service.ts (line 20).

But that does not automatically make the payment true P2P.

Current CamPay flow is:

Parent/customer pays grossAmount.
FlowPay sends CamPay a normal collection request with:
amount
payer phone
transaction reference
CamPay collects from the payer.
If it is Mode 2 / saved recipient, FlowPay later creates payout coordination.
Then FlowPay/CamPay payout sends settlementAmount to the recipient wallet.
That means money is not moving directly from payer to school/recipient in one provider-native split transaction. CamPay collection currently does not receive the recipient destination during payment authorization. The recipient payout happens later through /api/withdraw/ in campay.adapter.ts (line 155).

So the current system is:

payer -> provider collection -> FlowPay settlement/payout coordination -> recipient

Not:

payer -> recipient directly, with FlowPay only orchestrating

The architecture already has the concept for real P2P/native split: NATIVE_SPLIT. The schema and provider capability model know about it. But the current gateway charge interface does not pass split destination/subaccount data, and the current CamPay adapter does not implement native split. So it is architecture-ready, but not truly active end-to-end today.

Important distinction:

Add-on fee exists today: yes.
Recipient receives full base amount: intended, yes.
True provider-native P2P exists today: no, not for the current CamPay flow.
Mode 2 today: saved-recipient routing plus payout coordination.
True future P2P: would require provider-native split/direct recipient support, where the payment request itself includes the recipient destination and the provider routes funds directly.
So your concern is valid: if FlowPay wants real peer-to-peer/non-custodial behavior, credits/metering become important because FlowPay may not be able to touch or percentage-charge the money flow itself unless the provider supports native split/commission.