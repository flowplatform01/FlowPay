import type { GatewayProvider } from "@prisma/client";

export const PAYMENT_METHODS = [
  {
    id: "MTN_MOMO",
    label: "MTN Mobile Money",
    type: "Mobile Money",
    defaultFee: 0,
    provider: "CAMPAY" as GatewayProvider
  },
  {
    id: "ORANGE_MONEY",
    label: "Orange Money",
    type: "Mobile Money",
    defaultFee: 0,
    provider: "MAVIANCE" as GatewayProvider
  },
  {
    id: "CARD_PAYMENT",
    label: "Card Payment",
    type: "Cards",
    defaultFee: 0,
    provider: "CINETPAY" as GatewayProvider
  },
  {
    id: "BANK_TRANSFER",
    label: "Bank Transfer",
    type: "Bank Transfer",
    defaultFee: 0,
    provider: "CINETPAY" as GatewayProvider
  }
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

const methodById = new Map(PAYMENT_METHODS.map((method) => [method.id, method]));
const methodByProvider = new Map(PAYMENT_METHODS.map((method) => [method.provider, method]));

export function resolveProviderFromPaymentMethod(paymentMethod: string): GatewayProvider {
  const method = methodById.get(paymentMethod as PaymentMethodId);
  if (!method) {
    throw new Error("Unsupported payment method");
  }

  return method.provider;
}

export function getPaymentMethodForProvider(provider: GatewayProvider) {
  return methodByProvider.get(provider) ?? PAYMENT_METHODS[0];
}

export function listPublicPaymentMethods() {
  return PAYMENT_METHODS.map(({ id, label, type, defaultFee }) => ({
    id,
    label,
    type,
    fee: defaultFee
  }));
}
