import type { FeeRuleType } from "@prisma/client";

export type FeeRuleRangeInput = {
  name?: string | null;
  sortOrder: number;
  minAmount: number;
  maxAmount?: number | null;
  type: FeeRuleType;
  flatAmount?: number;
  percentageRate?: number;
  isEnabled?: boolean;
};

export class FeeRuleRangeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeRuleRangeValidationError";
  }
}

export function validateFeeRuleRanges(ranges: FeeRuleRangeInput[]) {
  if (!ranges.length) {
    return;
  }

  const sorted = [...ranges].sort((left, right) => left.sortOrder - right.sortOrder);

  for (const range of sorted) {
    if (range.minAmount < 0) {
      throw new FeeRuleRangeValidationError("Range minimum amount cannot be negative");
    }

    if (range.maxAmount !== undefined && range.maxAmount !== null && range.maxAmount < 0) {
      throw new FeeRuleRangeValidationError("Range maximum amount cannot be negative");
    }

    if (
      range.maxAmount !== undefined &&
      range.maxAmount !== null &&
      range.minAmount > range.maxAmount
    ) {
      throw new FeeRuleRangeValidationError(
        `Range "${range.name ?? range.sortOrder}" has minAmount greater than maxAmount`
      );
    }

    if ((range.flatAmount ?? 0) < 0 || (range.percentageRate ?? 0) < 0) {
      throw new FeeRuleRangeValidationError("Range fee values cannot be negative");
    }
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const currentMax = current.maxAmount ?? Number.POSITIVE_INFINITY;

    for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
      const other = sorted[otherIndex];
      const otherMax = other.maxAmount ?? Number.POSITIVE_INFINITY;

      const overlaps =
        current.minAmount <= otherMax &&
        other.minAmount <= currentMax;

      if (overlaps) {
        throw new FeeRuleRangeValidationError(
          `Ranges "${current.name ?? current.sortOrder}" and "${other.name ?? other.sortOrder}" overlap`
        );
      }
    }
  }
}
