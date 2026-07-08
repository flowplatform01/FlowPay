import assert from "node:assert/strict";
import test from "node:test";
import { FeeRangeMatchError, resolvePlatformFeeInputs } from "./fee-rule.resolver.js";

const baseRule = {
  id: "rule-1",
  name: "Standard",
  type: "HYBRID" as const,
  flatAmount: { toString: () => "100" },
  percentageRate: { toString: () => "1.5" },
  advancedBillingEnabled: true,
  rangeFallbackStrategy: "USE_STANDARD_RULE" as const,
  ranges: [
    {
      id: "range-1",
      feeRuleId: "rule-1",
      name: "Small",
      sortOrder: 1,
      minAmount: { toString: () => "1" } as any,
      maxAmount: { toString: () => "1000" } as any,
      type: "FLAT" as const,
      flatAmount: { toString: () => "50" } as any,
      percentageRate: { toString: () => "0" } as any,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

test("resolvePlatformFeeInputs matches amount range", () => {
  const resolved = resolvePlatformFeeInputs(baseRule, 500);
  assert.equal(resolved.flatAmount, 50);
  assert.equal(resolved.match.matchedRangeName, "Small");
});

test("resolvePlatformFeeInputs falls back to standard rule", () => {
  const resolved = resolvePlatformFeeInputs(baseRule, 5000);
  assert.equal(resolved.flatAmount, 100);
  assert.equal(resolved.match.fallbackUsed, true);
});

test("resolvePlatformFeeInputs rejects when configured", () => {
  assert.throws(
    () =>
      resolvePlatformFeeInputs(
        { ...baseRule, rangeFallbackStrategy: "REJECT" },
        5000,
      ),
    FeeRangeMatchError,
  );
});
