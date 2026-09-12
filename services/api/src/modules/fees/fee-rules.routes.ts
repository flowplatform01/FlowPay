import type { FastifyInstance } from "fastify";
import { FeeRangeFallbackStrategy, GatewayProvider } from "@prisma/client";
import { z } from "zod";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  FeeRangeMatchError,
  FeeRuleRangeValidationError,
  getActiveGlobalFeeRule,
  previewFeeCalculation,
  replaceFeeRuleRanges,
  updateFeeRuleAdvancedBilling,
  updateOrCreateGlobalFeeRule
} from "./fee-rules.service.js";

const rangeSchema = z.object({
  name: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  type: z.enum(["FLAT", "PERCENTAGE", "HYBRID", "DYNAMIC"]),
  flatAmount: z.number().nonnegative().optional(),
  percentageRate: z.number().nonnegative().optional(),
  isEnabled: z.boolean().optional()
});

const updateAdvancedBillingSchema = z.object({
  advancedBillingEnabled: z.boolean().optional(),
  rangeFallbackStrategy: z.nativeEnum(FeeRangeFallbackStrategy).optional()
});

const replaceRangesSchema = z.object({
  ranges: z.array(rangeSchema),
  advancedBillingEnabled: z.boolean().optional(),
  rangeFallbackStrategy: z.nativeEnum(FeeRangeFallbackStrategy).optional()
});

const globalFeeRuleSchema = z.object({
  name: z.string().min(2).optional(),
  type: z.enum(["FLAT", "PERCENTAGE", "HYBRID", "DYNAMIC"]).optional(),
  flatAmount: z.number().nonnegative().optional(),
  percentageRate: z.number().nonnegative().optional(),
  dynamicConfig: z.record(z.any()).optional(),
  advancedBillingEnabled: z.boolean().optional(),
  rangeFallbackStrategy: z.nativeEnum(FeeRangeFallbackStrategy).optional(),
  isActive: z.boolean().optional()
});

const previewSchema = z.object({
  organizationId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  provider: z.nativeEnum(GatewayProvider).optional()
});

export async function registerFeeRoutes(app: FastifyInstance) {
  // Global Fee Rule endpoints
  app.get("/internal/fee-rules/global", { preHandler: [verifyInternalService] }, async () => {
    return (await getActiveGlobalFeeRule()) ?? null;
  });

  app.put("/internal/fee-rules/global", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = globalFeeRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid global fee rule payload" });
    }
    return reply.send(await updateOrCreateGlobalFeeRule(parsed.data));
  });

  app.put("/internal/fee-rules/global/ranges", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = replaceRangesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid fee rule ranges payload" });
    }

    const globalRule = await updateOrCreateGlobalFeeRule({});
    try {
      return reply.send(
        await replaceFeeRuleRanges(globalRule.id, parsed.data.ranges, {
          advancedBillingEnabled: parsed.data.advancedBillingEnabled,
          rangeFallbackStrategy: parsed.data.rangeFallbackStrategy
        })
      );
    } catch (error) {
      if (error instanceof FeeRuleRangeValidationError) {
        return reply.code(400).send({ message: error.message });
      }
      return reply.code(500).send({ message: "Unable to update global fee rule ranges" });
    }
  });

  app.put("/internal/fee-rules/:id/advanced-billing", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateAdvancedBillingSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid advanced billing payload" });
    }

    const { id } = request.params as { id: string };

    try {
      return reply.send(await updateFeeRuleAdvancedBilling(id, parsed.data));
    } catch {
      return reply.code(404).send({ message: "Fee rule not found" });
    }
  });

  app.put("/internal/fee-rules/:id/ranges", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = replaceRangesSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid fee rule ranges payload" });
    }

    const { id } = request.params as { id: string };

    try {
      return reply.send(
        await replaceFeeRuleRanges(id, parsed.data.ranges, {
          advancedBillingEnabled: parsed.data.advancedBillingEnabled,
          rangeFallbackStrategy: parsed.data.rangeFallbackStrategy
        })
      );
    } catch (error) {
      if (error instanceof FeeRuleRangeValidationError) {
        return reply.code(400).send({ message: error.message });
      }

      return reply.code(404).send({ message: "Fee rule not found" });
    }
  });

  app.post("/internal/fees/preview", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid fee preview payload" });
    }

    try {
      return reply.send(await previewFeeCalculation(parsed.data));
    } catch (error) {
      if (error instanceof FeeRangeMatchError) {
        return reply.code(422).send({ message: error.message });
      }

      throw error;
    }
  });
}

