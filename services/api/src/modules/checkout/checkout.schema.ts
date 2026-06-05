import { z } from "zod";
import { PAYMENT_METHODS } from "../payments/payment-channels.js";

const paymentMethodIds = PAYMENT_METHODS.map((method) => method.id) as [string, ...string[]];

export const confirmCheckoutSchema = z.object({
  paymentMethod: z.enum(paymentMethodIds)
});

export const checkoutSessionQuerySchema = z.object({
  token: z.string().min(16)
});
