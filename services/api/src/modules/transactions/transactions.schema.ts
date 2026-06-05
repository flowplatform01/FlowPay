import { z } from "zod";
import { GatewayProvider } from "@prisma/client";
import { PAYMENT_METHODS } from "../payments/payment-channels.js";

const paymentMethodIds = PAYMENT_METHODS.map((method) => method.id) as [string, ...string[]];

export const createTransactionSchema = z
  .object({
    externalReference: z.string().min(3),
    amount: z.number().positive(),
    currency: z.string().length(3),
    provider: z.nativeEnum(GatewayProvider).optional(),
    paymentMethod: z.enum(paymentMethodIds).optional(),
    externalRecipientId: z.string().min(2).optional(),
    external_recipient_id: z.string().min(2).optional(),
    externalRecipientReference: z.string().min(2).optional(),
    external_recipient_reference: z.string().min(2).optional(),
    deferCapture: z.boolean().optional().default(true),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })
  .refine((value) => Boolean(value.provider || value.paymentMethod), {
    message: "Either paymentMethod or provider is required",
    path: ["paymentMethod"]
  })
  .transform((value) => ({
    ...value,
    externalRecipientId:
      value.externalRecipientId ??
      value.external_recipient_id ??
      value.externalRecipientReference ??
      value.external_recipient_reference
  }));
