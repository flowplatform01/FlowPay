/**
 * Confirmation Gateway workflows (internal architecture label).
 *
 * These are not payment orchestration modes (Mode 1 / Mode 2). They group flows where:
 * - An external application collects initial data
 * - FlowPay hosts review + explicit user confirmation
 * - FlowPay executes the final save/settlement only after confirmation
 */
export const CONFIRMATION_GATEWAY_WORKFLOWS = {
  RECIPIENT_SETUP: "RECIPIENT_SETUP",
  CREDIT_TOPUP: "CREDIT_TOPUP",
  RECIPIENT_VERIFICATION: "RECIPIENT_VERIFICATION"
} as const;

export type ConfirmationGatewayWorkflow =
  (typeof CONFIRMATION_GATEWAY_WORKFLOWS)[keyof typeof CONFIRMATION_GATEWAY_WORKFLOWS];

export const CONFIRMATION_GATEWAY_METADATA_KEY = "__flowpay_confirmation_gateway";

export type RecipientConfirmationSessionView = {
  id: string;
  workflow: typeof CONFIRMATION_GATEWAY_WORKFLOWS.RECIPIENT_SETUP;
  externalRecipientId: string;
  displayName: string | null;
  payoutTarget: string;
  paymentRailLabel: string;
  regionalCurrency: string;
  editableFields: Array<"payoutTarget">;
  app: { name: string; slug: string };
  organization: { name: string; slug: string };
  capacityEligibility?: {
    eligible: boolean;
    effectiveBalance: number;
    minCreditRequired: number;
    currentUsage: number;
    effectiveMaxCapacity: number | null;
    remainingCapacity: number | null;
    activeTier: CapacityEligibilityTierView | null;
    nextTier: CapacityEligibilityTierView | null;
    canActivate: boolean;
    canCreate: boolean;
    reasons: string[];
  };
};

type CapacityEligibilityTierView = {
  tierKey: string;
  name: string;
  description: string | null;
  maxCapacity: number | null;
  minEffectiveCredit: number;
};

export type CreditTopUpCheckoutView = {
  workflow: typeof CONFIRMATION_GATEWAY_WORKFLOWS.CREDIT_TOPUP;
  purchaseAmountXaf: number;
  currentEffectiveBalance: number;
  projectedEffectiveBalance: number;
};
