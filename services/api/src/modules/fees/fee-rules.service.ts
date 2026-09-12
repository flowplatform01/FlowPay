import type { FeeRangeFallbackStrategy, FeeRuleType, GatewayProvider, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { buildSettlementBreakdown } from "../settlements/settlements.service.js";
import { calculateFees } from "./fees.service.js";
import {
  buildFeeBreakdownMetadata,
  FeeRangeMatchError,
  resolvePlatformFeeInputs
} from "./fee-rule.resolver.js";
import { FeeRuleRangeValidationError, validateFeeRuleRanges, type FeeRuleRangeInput } from "./fee-rules.validation.js";
import { invalidateFeeRuleRoutingCache } from "../transactions/routing-cache.js";

const feeRuleInclude = {
  ranges: {
    orderBy: { sortOrder: "asc" as const }
  }
};

export async function getActiveGlobalFeeRule() {
  return prisma.feeRule.findFirst({
    where: { organizationId: null, isActive: true },
    include: feeRuleInclude,
    orderBy: { createdAt: "desc" }
  });
}

export async function getActiveFeeRuleForOrganization(organizationId: string) {
  // 1. Tenant-specific override
  const tenantRule = await prisma.feeRule.findFirst({
    where: { organizationId, isActive: true },
    include: feeRuleInclude,
    orderBy: { createdAt: "desc" }
  });

  if (tenantRule) {
    return tenantRule;
  }

  // 2. Global platform default fallback
  return getActiveGlobalFeeRule();
}

export async function updateOrCreateGlobalFeeRule(input: {
  name?: string;
  type?: FeeRuleType;
  flatAmount?: number;
  percentageRate?: number;
  dynamicConfig?: Record<string, unknown>;
  advancedBillingEnabled?: boolean;
  rangeFallbackStrategy?: FeeRangeFallbackStrategy;
  isActive?: boolean;
}) {
  const existing = await getActiveGlobalFeeRule();

  let feeRule;
  if (existing) {
    feeRule = await prisma.feeRule.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? existing.name,
        type: input.type ?? existing.type,
        flatAmount: input.flatAmount === undefined ? undefined : input.flatAmount.toFixed(2),
        percentageRate: input.percentageRate === undefined ? undefined : input.percentageRate.toFixed(4),
        dynamicConfig: input.dynamicConfig as Prisma.InputJsonValue | undefined,
        advancedBillingEnabled: input.advancedBillingEnabled ?? existing.advancedBillingEnabled,
        rangeFallbackStrategy: input.rangeFallbackStrategy ?? existing.rangeFallbackStrategy,
        isActive: input.isActive ?? true
      },
      include: feeRuleInclude
    });
  } else {
    feeRule = await prisma.feeRule.create({
      data: {
        organizationId: null,
        name: input.name ?? "Global Platform Default",
        type: input.type ?? "HYBRID",
        flatAmount: input.flatAmount === undefined ? "0.00" : input.flatAmount.toFixed(2),
        percentageRate: input.percentageRate === undefined ? "0.0000" : input.percentageRate.toFixed(4),
        dynamicConfig: input.dynamicConfig as Prisma.InputJsonValue | undefined,
        advancedBillingEnabled: input.advancedBillingEnabled ?? false,
        rangeFallbackStrategy: input.rangeFallbackStrategy ?? "USE_STANDARD_RULE",
        isActive: input.isActive ?? true
      },
      include: feeRuleInclude
    });
  }

  invalidateFeeRuleRoutingCache();

  await recordAuditEvent({
    action: "fee_rule.global_updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "FeeRule",
    entityId: feeRule.id,
    payload: {
      advancedBillingEnabled: feeRule.advancedBillingEnabled,
      rangeFallbackStrategy: feeRule.rangeFallbackStrategy,
      type: feeRule.type
    }
  });

  return feeRule;
}

export async function updateFeeRuleAdvancedBilling(
  feeRuleId: string,
  input: {
    advancedBillingEnabled?: boolean;
    rangeFallbackStrategy?: FeeRangeFallbackStrategy;
  }
) {
  const feeRule = await prisma.feeRule.update({
    where: { id: feeRuleId },
    data: {
      advancedBillingEnabled: input.advancedBillingEnabled,
      rangeFallbackStrategy: input.rangeFallbackStrategy
    },
    include: feeRuleInclude
  });

  invalidateFeeRuleRoutingCache(feeRule.organizationId ?? undefined);

  await recordAuditEvent({
    action: "fee_rule.advanced_billing_updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "FeeRule",
    entityId: feeRule.id,
    payload: {
      advancedBillingEnabled: feeRule.advancedBillingEnabled,
      rangeFallbackStrategy: feeRule.rangeFallbackStrategy
    }
  });

  return feeRule;
}

export async function replaceFeeRuleRanges(
  feeRuleId: string,
  ranges: FeeRuleRangeInput[],
  options?: {
    advancedBillingEnabled?: boolean;
    rangeFallbackStrategy?: FeeRangeFallbackStrategy;
  }
) {
  validateFeeRuleRanges(ranges);

  await prisma.$transaction(async (tx) => {
    await tx.feeRuleRange.deleteMany({
      where: { feeRuleId }
    });

    if (ranges.length) {
      await tx.feeRuleRange.createMany({
        data: ranges.map((range) => ({
          feeRuleId,
          name: range.name ?? null,
          sortOrder: range.sortOrder,
          minAmount: range.minAmount.toFixed(2),
          maxAmount: range.maxAmount === undefined || range.maxAmount === null ? null : range.maxAmount.toFixed(2),
          type: range.type,
          flatAmount: range.flatAmount === undefined ? null : range.flatAmount.toFixed(2),
          percentageRate:
            range.percentageRate === undefined ? null : range.percentageRate.toFixed(4),
          isEnabled: range.isEnabled ?? true
        }))
      });
    }

    if (options && (options.advancedBillingEnabled !== undefined || options.rangeFallbackStrategy !== undefined)) {
      await tx.feeRule.update({
        where: { id: feeRuleId },
        data: {
          advancedBillingEnabled: options.advancedBillingEnabled,
          rangeFallbackStrategy: options.rangeFallbackStrategy
        }
      });
    }
  });

  const feeRule = await prisma.feeRule.findUniqueOrThrow({
    where: { id: feeRuleId },
    include: feeRuleInclude
  });

  invalidateFeeRuleRoutingCache(feeRule.organizationId ?? undefined);

  await recordAuditEvent({
    action: "fee_rule.ranges_updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "FeeRule",
    entityId: feeRule.id,
    payload: {
      rangeCount: ranges.length,
      advancedBillingEnabled: feeRule.advancedBillingEnabled
    }
  });

  return feeRule;
}

export async function previewFeeCalculation(input: {
  organizationId: string;
  amount: number;
  currency?: string;
  provider?: GatewayProvider;
}) {
  const [feeRule, gateway] = await Promise.all([
    getActiveFeeRuleForOrganization(input.organizationId),
    input.provider
      ? prisma.gatewayConfig.findUnique({
          where: { provider: input.provider },
          include: { health: true }
        })
      : Promise.resolve(null)
  ]);

  let platformInputs;

  try {
    platformInputs = resolvePlatformFeeInputs(feeRule, input.amount);
  } catch (error) {
    if (error instanceof FeeRangeMatchError) {
      throw error;
    }
    throw error;
  }

  const gatewayMetadata = asRecord(gateway?.metadata);
  const fees = calculateFees({
    baseAmount: input.amount,
    currency: input.currency,
    flatAmount: platformInputs.flatAmount,
    percentageRate: platformInputs.percentageRate,
    gatewayFlatAmount: asNumber(gatewayMetadata.providerFeeFlatAmount),
    gatewayPercentageRate: asNumber(gatewayMetadata.providerFeePercentageRate)
  });

  const settlement = buildSettlementBreakdown({
    amount: input.amount,
    grossAmount: fees.grossAmount,
    gatewayFeeAmount: fees.gatewayFeeAmount,
    platformFeeAmount: fees.platformFeeAmount
  });

  return {
    feeRule: feeRule
      ? {
          id: feeRule.id,
          name: feeRule.name,
          type: feeRule.type,
          isGlobal: feeRule.organizationId === null,
          advancedBillingEnabled: feeRule.advancedBillingEnabled,
          rangeFallbackStrategy: feeRule.rangeFallbackStrategy
        }
      : null,
    breakdown: buildFeeBreakdownMetadata(
      input.amount,
      input.currency,
      platformInputs,
      fees,
      settlement.settlementAmount
    ),
    fees,
    settlement
  };
}

export { FeeRangeMatchError, FeeRuleRangeValidationError };

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
