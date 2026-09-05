import assert from "node:assert/strict";
import { calculateFees } from "./fees.service.js";

const grossedUp = calculateFees({
  baseAmount: 1000,
  currency: "XAF",
  gatewayPercentageRate: 3
});

assert.equal(grossedUp.grossAmount, 1031);
assert.equal(grossedUp.gatewayFeeAmount, 31);
assert.equal(grossedUp.platformFeeAmount, 0);

const withPlatformAndFlat = calculateFees({
  baseAmount: 1000,
  currency: "XAF",
  flatAmount: 100,
  percentageRate: 2,
  gatewayFlatAmount: 25,
  gatewayPercentageRate: 3
});

assert.equal(withPlatformAndFlat.platformFeeAmount, 120);
assert.equal(withPlatformAndFlat.grossAmount, 1181);
assert.equal(withPlatformAndFlat.gatewayFeeAmount, 61);

assert.throws(
  () =>
    calculateFees({
      baseAmount: 1000,
      currency: "XAF",
      gatewayPercentageRate: 100
    }),
  /less than 100/
);

console.log("FEE_GROSS_UP_TEST_OK");
