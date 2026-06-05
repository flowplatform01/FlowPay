import { z } from "zod";
import { GatewayProvider } from "@prisma/client";

export const upsertDestinationProfileSchema = z.object({
  externalRecipientId: z.string().min(2),
  providerType: z.nativeEnum(GatewayProvider),
  payoutTarget: z.string().min(3),
  nativeSubaccountId: z.string().min(1).nullable().optional(),
  settlementStrategy: z.enum(["TWO_STEP_MIRROR", "NATIVE_SPLIT"]).default("TWO_STEP_MIRROR"),
  providerMetadata: z.record(z.any()).optional(),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]).default("PENDING"),
  supportedRails: z.array(z.string().min(2)).optional(),
  regionalCurrency: z.string().length(3),
  routingPreferences: z.record(z.any()).optional()
});

export const updateDestinationProfileSchema = upsertDestinationProfileSchema.partial().extend({
  externalRecipientId: z.string().min(2).optional()
});
