import type { CapacityResourceType } from "@prisma/client";

export type CapacityEligibilityReasonCode =
  | "INSUFFICIENT_CREDIT"
  | "CAPACITY_EXCEEDED"
  | "ADMIN_LIMIT_EXCEEDED"
  | "APPLICATION_SUSPENDED"
  | "PROVISIONING_DISABLED"
  | "ENFORCEMENT_BLOCKED"
  | "NO_ELIGIBLE_TIER";

export type CapacityEligibilityTierView = {
  tierKey: string;
  name: string;
  description: string | null;
  maxCapacity: number | null;
  minEffectiveCredit: number;
};

export type CapacityEligibilitySnapshot = {
  resourceType: CapacityResourceType;
  eligible: boolean;
  enforcementEnabled: boolean;
  effectiveBalance: number;
  minCreditRequired: number;
  currentUsage: number;
  effectiveMaxCapacity: number | null;
  remainingCapacity: number | null;
  administrativeLimit: number;
  activeTier: CapacityEligibilityTierView | null;
  nextTier: CapacityEligibilityTierView | null;
  reasons: Array<{
    code: CapacityEligibilityReasonCode;
    message: string;
  }>;
  canActivateRecipient: boolean;
  canCreateRecipient: boolean;
};

export type CapacityPolicyTierInput = {
  tierKey: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  maxCapacity?: number | null;
  minEffectiveCredit: number;
  enabled?: boolean;
};

export type AppCapacityOverrideInput = {
  enforcementDisabled?: boolean;
  maxCapacityOverride?: number | null;
  minEffectiveCreditOverride?: number | null;
  unlimitedCapacityGranted?: boolean;
  notes?: string | null;
};
