# FlowPay Checkout Fee, Provider Email, and Mode Controls Audit

## Existing State Verified

- FlowPay already calculates and stores platform fee and gateway/provider fee separately on each transaction.
- Gross amount, settlement amount, treasury fee capture, reconciliation, and reporting continue to use the original separated values.
- Checkout previously displayed both fee components as separate customer-facing lines.
- `customerEmail` is accepted by SDK/API transaction creation and persisted on transactions.
- Fapshi receives `email` during direct-pay collection when `customerEmail` is supplied.
- CinetPay receives `customer_email` during collection when `customerEmail` is supplied.
- CamPay collection currently does not send customer email in its adapter payload; this appears provider/API-specific and was not duplicated with a FlowPay-owned email system.
- Existing app controls already include PAYIN capability, provider access, organization provider access, app suspension, runtime mode, and metering controls.
- `mode1MeteringEnabled` and `mode2MeteringEnabled` are metering/credit controls only. They were not true collection availability controls.

## Implemented Changes

### Checkout Fee Presentation

- Added app-level `checkoutFeePresentation` with values:
  - `SEPARATE`
  - `COMBINED`
- New transactions snapshot this app setting into transaction metadata.
- Checkout session serialization exposes `feePresentation` to checkout-web.
- Checkout-web now preserves the existing separate fee display by default.
- When configured as `COMBINED`, checkout displays one customer-facing line:
  - `Service fee`
- The combined line is only presentation: it is `platformFeeAmount + gatewayFeeAmount`.
- Underlying transaction amounts, ledger records, settlement behavior, treasury capture, reconciliation, refunds, and reporting remain unchanged.

### Mode 1 / Mode 2 Collection Controls

- Added app-level operational controls:
  - `mode1CollectionsEnabled`
  - `mode2CollectionsEnabled`
- Defaults are enabled to preserve existing production behavior.
- Enforcement happens in `createTransaction` after FlowPay resolves the orchestration route:
  - Mode 1 maps to `PLATFORM_REVENUE`.
  - Mode 2 maps to `MULTI_TENANT`.
- Disabling a mode blocks new collection creation through direct API requests and app integrations.
- Existing pending/processing/succeeded transactions are not mutated.
- Metering flags remain separate and unchanged.

### Flow Admin

- Exposed app-level controls in the existing Application Configuration panel:
  - Mode 1 Collections
  - Mode 2 Collections
  - Checkout Fee Display
- Existing Mode 1/Mode 2 Metering controls remain available and separate.
- Flow Admin backend proxy/types were updated to preserve the new fields.

## Provider Email Findings

- FlowPay already passes customer email through its transaction model and supported provider adapters where provider APIs expose an email field.
- Fapshi: supported by current adapter payload.
- CinetPay: supported by current adapter payload.
- CamPay: current collection adapter does not pass email. No duplicate FlowPay email notification system was added because provider notification delivery is provider-controlled.
- Provider email notifications may still depend on provider-side configuration and transaction type.

## Migration

Added migration:

`services/api/prisma/migrations/20261009120000_checkout_fee_presentation_mode_controls/migration.sql`

It adds:

- `CheckoutFeePresentation` enum
- `App.mode1CollectionsEnabled`
- `App.mode2CollectionsEnabled`
- `App.checkoutFeePresentation`

## Verification

- `npm run build` in `FlowPay` passed.
- `npm run build` in `flow-admin` passed.
- FlowPay build regenerated Prisma Client successfully.
- Flow Admin backend and frontend compiled successfully.

## Remaining Notes

- Deploy the FlowPay migration before relying on the new app controls in production.
- Provider confirmation emails should be treated as best-effort provider behavior, not guaranteed FlowPay-owned delivery.
- Existing PAYIN/provider/organization controls remain the broader access-control layer; the new switches are precise app-level Mode 1/Mode 2 collection controls.
