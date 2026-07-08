type FeeInput = {
  baseAmount: number;
  currency?: string;
  flatAmount?: number;
  percentageRate?: number;
  gatewayFlatAmount?: number;
  gatewayPercentageRate?: number;
};

export function calculateFees({
  baseAmount,
  currency,
  flatAmount = 0,
  percentageRate = 0,
  gatewayFlatAmount = 0,
  gatewayPercentageRate = 0
}: FeeInput) {
  const normalize = zeroDecimalCurrencies.has(currency?.toUpperCase() ?? "")
    ? roundZeroDecimal
    : roundDecimal;

  const percentageFee = normalize((baseAmount * percentageRate) / 100);
  const platformFee = normalize(flatAmount + percentageFee);
  // gateway* fields are FlowPay's configured route-pricing layer for a provider
  // route. They are not a live pass-through estimate of the external provider's
  // own commercial charges.
  const gatewayPercentageFee = normalize((baseAmount * gatewayPercentageRate) / 100);
  const gatewayFeeAmount = normalize(gatewayFlatAmount + gatewayPercentageFee);

  return {
    baseAmount,
    gatewayFeeAmount,
    platformFeeAmount: platformFee,
    grossAmount: normalize(baseAmount + platformFee + gatewayFeeAmount)
  };
}

const zeroDecimalCurrencies = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

function roundDecimal(value: number) {
  return Number(value.toFixed(2));
}

function roundZeroDecimal(value: number) {
  return Math.ceil(value);
}
