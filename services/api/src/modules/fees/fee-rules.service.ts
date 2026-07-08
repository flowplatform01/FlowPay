import type { FeeRangeFallbackStrategy, GatewayProvider } from "@prisma/client";
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

const feeRuleInclude = {
  ranges: {
    orderBy: { sortOrder: "asc" as const }
  }
};

export async function getActiveFeeRuleForOrganization(organizationId: string) {
  return prisma.feeRule.findFirst({
    where: { organizationId, isActive: true },
    include: feeRuleInclude,
    orderBy: { createdAt: "desc" }
  });
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

export async function replaceFeeRuleRanges(feeRuleId: string, ranges: FeeRuleRangeInput[]) {
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
  });

  const feeRule = await prisma.feeRule.findUniqueOrThrow({
    where: { id: feeRuleId },
    include: feeRuleInclude
  });

  await recordAuditEvent({
    action: "fee_rule.ranges_updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "FeeRule",
    entityId: feeRule.id,
    payload: {
      rangeCount: ranges.length
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
