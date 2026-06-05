import { z } from "zod";

export const updateProviderConfigSchema = z.object({
  isEnabled: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  displayName: z.string().min(2).optional(),
  mode: z.enum(["sandbox", "live"]).optional(),
  routeStrategy: z.enum(["primary", "failover", "standby"]).optional(),
  providerFeeFlatAmount: z.number().min(0).optional(),
  providerFeePercentageRate: z.number().min(0).max(100).optional(),
  providerPayoutFeeFlatAmount: z.number().min(0).optional(),
  providerPayoutFeePercentageRate: z.number().min(0).max(100).optional(),
  capabilities: z.array(z.string().min(2)).optional(),
  healthStatus: z.enum(["healthy", "degraded", "offline"]).optional()
});
