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
  // route. Percentage-based provider fees are grossed up so that the configured
  // net amount plus FlowPay platform fee remain whole after provider charges.
  const gatewayRate = gatewayPercentageRate / 100;
  if (gatewayRate >= 1) {
    throw new Error("Gateway percentage rate must be less than 100%");
  }

  const netBeforeGatewayFee = baseAmount + platformFee;
  const grossBeforeRounding =
    gatewayRate > 0
      ? (netBeforeGatewayFee + gatewayFlatAmount) / (1 - gatewayRate)
      : netBeforeGatewayFee + gatewayFlatAmount;
  const grossAmount = normalize(grossBeforeRounding);
  const gatewayFeeAmount = normalize(grossAmount - netBeforeGatewayFee);

  return {
    baseAmount,
    gatewayFeeAmount,
    platformFeeAmount: platformFee,
    grossAmount
  };
}

const zeroDecimalCurrencies = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

function roundDecimal(value: number) {
  return Number(value.toFixed(2));
}

function roundZeroDecimal(value: number) {
  return Math.ceil(value);
}
