import { z } from "zod";
import { GatewayProvider } from "@prisma/client";

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  countryCode: z.string().length(2),
  settlementCurrency: z.string().length(3)
});

export const updateOrganizationSettingsSchema = z.object({
  settlementCurrency: z.string().length(3).optional(),
  enabledProviders: z
    .array(
      z.object({
        provider: z.nativeEnum(GatewayProvider),
        isEnabled: z.boolean()
      })
    )
    .optional()
});

export const upsertPayoutDestinationSchema = z.object({
  label: z.string().min(2),
  destinationType: z.string().min(2),
  destinationRef: z.string().min(3),
  currency: z.string().length(3),
  isDefault: z.boolean().optional()
});

export const createFeeRuleSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["FLAT", "PERCENTAGE", "HYBRID", "DYNAMIC"]),
  flatAmount: z.number().nonnegative().optional(),
  percentageRate: z.number().nonnegative().optional(),
  dynamicConfig: z.record(z.any()).optional(),
  isActive: z.boolean().optional()
});

export const updateFeeRuleSchema = createFeeRuleSchema.partial();
