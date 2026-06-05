export const PAYMENT_METHODS = [
  { id: "MTN_MOMO", label: "MTN Mobile Money", type: "Mobile Money", fee: 0 },
  { id: "ORANGE_MONEY", label: "Orange Money", type: "Mobile Money", fee: 0 },
  { id: "CARD_PAYMENT", label: "Card Payment", type: "Cards", fee: 0 },
  { id: "BANK_TRANSFER", label: "Bank Transfer", type: "Bank Transfer", fee: 0 }
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

export function getPaymentMethod(id: PaymentMethodId) {
  return PAYMENT_METHODS.find((method) => method.id === id) ?? PAYMENT_METHODS[0];
}
