import { z } from "zod";
import { GatewayProvider } from "@prisma/client";

export const createAppSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  organizationId: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  orchestrationCredits: z.number().nonnegative().optional(),
  processingUnits: z.number().nonnegative().optional(),
  infrastructureUsageBalance: z.number().nonnegative().optional(),
  autoCreditRefillEnabled: z.boolean().optional(),
  autoCreditRefillThreshold: z.number().nonnegative().optional(),
  autoCreditRefillAmount: z.number().nonnegative().optional(),
  autoCreditRefillProvider: z.nativeEnum(GatewayProvider).nullable().optional(),
  mode1MeteringEnabled: z.boolean().optional(),
  mode2MeteringEnabled: z.boolean().optional(),
  destinationProfileProvisioningEnabled: z.boolean().optional(),
  destinationProfileAutoVerifyEnabled: z.boolean().optional(),
  destinationProfileLimit: z.number().int().nonnegative().max(10000).optional(),
  recipientVerificationPaymentEnabled: z.boolean().optional(),
  recipientVerificationAmountXaf: z.number().positive().optional()
});

export const updateAppSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  orchestrationCredits: z.number().nonnegative().optional(),
  processingUnits: z.number().nonnegative().optional(),
  infrastructureUsageBalance: z.number().nonnegative().optional(),
  autoCreditRefillEnabled: z.boolean().optional(),
  autoCreditRefillThreshold: z.number().nonnegative().optional(),
  autoCreditRefillAmount: z.number().nonnegative().optional(),
  autoCreditRefillProvider: z.nativeEnum(GatewayProvider).nullable().optional(),
  mode1MeteringEnabled: z.boolean().optional(),
  mode2MeteringEnabled: z.boolean().optional(),
  destinationProfileProvisioningEnabled: z.boolean().optional(),
  destinationProfileAutoVerifyEnabled: z.boolean().optional(),
  destinationProfileLimit: z.number().int().nonnegative().max(10000).optional(),
  recipientVerificationPaymentEnabled: z.boolean().optional(),
  recipientVerificationAmountXaf: z.number().positive().optional()
});

export const topUpAppCreditsSchema = z
  .object({
    amount: z.number().positive().optional(),
    infrastructureUsageBalance: z.number().positive().optional(),
    processingUnits: z.number().positive().optional(),
    orchestrationCredits: z.number().positive().optional(),
    rechargeReference: z.string().min(3).optional(),
    note: z.string().min(2).optional()
  })
  .refine(
    (value) =>
      value.amount !== undefined ||
      value.infrastructureUsageBalance !== undefined ||
      value.processingUnits !== undefined ||
      value.orchestrationCredits !== undefined,
    {
      message: "At least one credit amount is required"
    }
  );

export const fundAppCreditsFromTreasurySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default("XAF"),
  provider: z.nativeEnum(GatewayProvider),
  reason: z.string().min(2).optional()
});

export const rotateAppCredentialsSchema = z.object({
  rotateClientSecret: z.boolean().optional(),
  keyTypes: z.array(z.enum(["PUBLIC", "SECRET", "WEBHOOK"])).optional()
});

export const updateAppAccessSchema = z.object({
  providers: z
    .array(
      z.object({
        provider: z.nativeEnum(GatewayProvider),
        isEnabled: z.boolean(),
        priority: z.number().int().positive().optional()
      })
    )
    .optional(),
  capabilities: z
    .array(
      z.object({
        capability: z.string().min(2),
        isEnabled: z.boolean()
      })
    )
    .optional()
});
