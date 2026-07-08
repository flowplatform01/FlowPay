import type { FeeRangeFallbackStrategy, FeeRuleRange, FeeRuleType } from "@prisma/client";

export type FeeRuleWithRanges = {
  id: string;
  name: string;
  type: FeeRuleType;
  flatAmount: { toString(): string } | null;
  percentageRate: { toString(): string } | null;
  advancedBillingEnabled: boolean;
  rangeFallbackStrategy: FeeRangeFallbackStrategy;
  ranges?: FeeRuleRange[];
};

export type PlatformFeeMatchDetails = {
  advancedBillingEnabled: boolean;
  matchedRangeId?: string;
  matchedRangeName?: string | null;
  matchedRangeSortOrder?: number;
  fallbackUsed: boolean;
  fallbackStrategy?: FeeRangeFallbackStrategy;
  standardRuleUsed: boolean;
  appliedFlatAmount: number;
  appliedPercentageRate: number;
};

export type ResolvedPlatformFeeInputs = {
  flatAmount: number;
  percentageRate: number;
  match: PlatformFeeMatchDetails;
};

export class FeeRangeMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeRangeMatchError";
  }
}

function toNumber(value: { toString(): string } | null | undefined) {
  return value ? Number(value.toString()) : 0;
}

function findMatchingRange(ranges: FeeRuleRange[] | undefined, amount: number) {
  if (!ranges?.length) {
    return undefined;
  }

  const enabledRanges = ranges
    .filter((range) => range.isEnabled)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return enabledRanges.find((range) => {
    const minAmount = Number(range.minAmount);
    const maxAmount = range.maxAmount === null ? null : Number(range.maxAmount);
    return amount >= minAmount && (maxAmount === null || amount <= maxAmount);
  });
}

export function resolvePlatformFeeInputs(
  feeRule: FeeRuleWithRanges | null | undefined,
  baseAmount: number
): ResolvedPlatformFeeInputs {
  if (!feeRule) {
    return {
      flatAmount: 0,
      percentageRate: 0,
      match: {
        advancedBillingEnabled: false,
        fallbackUsed: false,
        standardRuleUsed: true,
        appliedFlatAmount: 0,
        appliedPercentageRate: 0
      }
    };
  }

  const standardFlatAmount = toNumber(feeRule.flatAmount);
  const standardPercentageRate = toNumber(feeRule.percentageRate);

  if (!feeRule.advancedBillingEnabled) {
    return {
      flatAmount: standardFlatAmount,
      percentageRate: standardPercentageRate,
      match: {
        advancedBillingEnabled: false,
        fallbackUsed: false,
        standardRuleUsed: true,
        appliedFlatAmount: standardFlatAmount,
        appliedPercentageRate: standardPercentageRate
      }
    };
  }

  const matchedRange = findMatchingRange(feeRule.ranges, baseAmount);

  if (matchedRange) {
    const flatAmount = toNumber(matchedRange.flatAmount);
    const percentageRate = toNumber(matchedRange.percentageRate);

    return {
      flatAmount,
      percentageRate,
      match: {
        advancedBillingEnabled: true,
        matchedRangeId: matchedRange.id,
        matchedRangeName: matchedRange.name,
        matchedRangeSortOrder: matchedRange.sortOrder,
        fallbackUsed: false,
        standardRuleUsed: false,
        appliedFlatAmount: flatAmount,
        appliedPercentageRate: percentageRate
      }
    };
  }

  switch (feeRule.rangeFallbackStrategy) {
    case "ZERO_FEE":
      return {
        flatAmount: 0,
        percentageRate: 0,
        match: {
          advancedBillingEnabled: true,
          fallbackUsed: true,
          fallbackStrategy: feeRule.rangeFallbackStrategy,
          standardRuleUsed: false,
          appliedFlatAmount: 0,
          appliedPercentageRate: 0
        }
      };
    case "REJECT":
      throw new FeeRangeMatchError(
        `No advanced billing range matches amount ${baseAmount} for fee rule "${feeRule.name}"`
      );
    case "USE_STANDARD_RULE":
    default:
      return {
        flatAmount: standardFlatAmount,
        percentageRate: standardPercentageRate,
        match: {
          advancedBillingEnabled: true,
          fallbackUsed: true,
          fallbackStrategy: feeRule.rangeFallbackStrategy,
          standardRuleUsed: true,
          appliedFlatAmount: standardFlatAmount,
          appliedPercentageRate: standardPercentageRate
        }
      };
  }
}

export function buildFeeBreakdownMetadata(
  baseAmount: number,
  currency: string | undefined,
  platformInputs: ResolvedPlatformFeeInputs,
  fees: {
    platformFeeAmount: number;
    gatewayFeeAmount: number;
    grossAmount: number;
  },
  settlementAmount: number
) {
  const percentageComponent = platformInputs.match.appliedPercentageRate
    ? (baseAmount * platformInputs.match.appliedPercentageRate) / 100
    : 0;

  return {
    transactionAmount: baseAmount,
    currency: currency ?? null,
    advancedBillingEnabled: platformInputs.match.advancedBillingEnabled,
    matchedRangeId: platformInputs.match.matchedRangeId ?? null,
    matchedRangeName: platformInputs.match.matchedRangeName ?? null,
    matchedRangeSortOrder: platformInputs.match.matchedRangeSortOrder ?? null,
    fallbackUsed: platformInputs.match.fallbackUsed,
    fallbackStrategy: platformInputs.match.fallbackStrategy ?? null,
    standardRuleUsed: platformInputs.match.standardRuleUsed,
    platformFlatAmount: platformInputs.match.appliedFlatAmount,
    platformPercentageRate: platformInputs.match.appliedPercentageRate,
    platformPercentageFee: percentageComponent,
    platformFeeAmount: fees.platformFeeAmount,
    gatewayFeeAmount: fees.gatewayFeeAmount,
    grossAmount: fees.grossAmount,
    settlementAmount
  };
}
