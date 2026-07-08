import type { GatewayProvider, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { getGatewayBalance } from "../gateways/gateways.service.js";
import { mergeProviderCapabilities, providerHealthScore } from "./provider-registry.js";

const providerInclude = {
  health: true
};

export async function listProviderConfigs() {
  const providers = await prisma.gatewayConfig.findMany({
    include: providerInclude,
    orderBy: { provider: "asc" }
  });

  return providers.map((provider) => withProviderRuntimeMetadata(provider));
}

export async function updateProviderConfig(
  provider: GatewayProvider,
  input: {
    isEnabled?: boolean;
    baseUrl?: string;
    displayName?: string;
    mode?: "sandbox" | "live";
    routeStrategy?: "primary" | "failover" | "standby";
    providerFeeFlatAmount?: number;
    providerFeePercentageRate?: number;
    providerPayoutFeeFlatAmount?: number;
    providerPayoutFeePercentageRate?: number;
    capabilities?: string[];
    healthStatus?: "healthy" | "degraded" | "offline";
  }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.gatewayConfig.findUniqueOrThrow({
      where: { provider },
      include: providerInclude
    });

    const metadata = {
      ...asRecord(existing.metadata),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.routeStrategy ? { routeStrategy: input.routeStrategy } : {}),
      ...(input.providerFeeFlatAmount !== undefined ? { providerFeeFlatAmount: input.providerFeeFlatAmount } : {}),
      ...(input.providerFeePercentageRate !== undefined
        ? { providerFeePercentageRate: input.providerFeePercentageRate }
        : {}),
      ...(input.providerPayoutFeeFlatAmount !== undefined
        ? { providerPayoutFeeFlatAmount: input.providerPayoutFeeFlatAmount }
        : {}),
      ...(input.providerPayoutFeePercentageRate !== undefined
        ? { providerPayoutFeePercentageRate: input.providerPayoutFeePercentageRate }
        : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {})
    } satisfies Prisma.InputJsonObject;

    const baseUrl = resolveProviderBaseUrl(provider, input);

    const config = await tx.gatewayConfig.update({
      where: { provider },
      data: {
        isEnabled: input.isEnabled,
        baseUrl,
        displayName: input.displayName,
        metadata
      },
      include: providerInclude
    });

    if (input.healthStatus || input.isEnabled !== undefined) {
      const status = input.healthStatus ?? (input.isEnabled ? "healthy" : "offline");

      await tx.gatewayHealth.upsert({
        where: { provider },
        update: {
          status,
          errorMessage: status === "healthy" ? null : `Marked ${status} by operator`,
          lastCheckedAt: new Date()
        },
        create: {
          provider,
          status,
          errorMessage: status === "healthy" ? null : `Marked ${status} by operator`,
          lastCheckedAt: new Date(),
          gatewayConfigId: config.id
        }
      });
    }

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "provider.configuration_updated",
        entityType: "GatewayConfig",
        entityId: config.id,
        payload: {
          provider,
          isEnabled: input.isEnabled,
          mode: metadata.mode,
          routeStrategy: metadata.routeStrategy,
          providerFeeFlatAmount: metadata.providerFeeFlatAmount,
          providerFeePercentageRate: metadata.providerFeePercentageRate,
          providerPayoutFeeFlatAmount: metadata.providerPayoutFeeFlatAmount,
          providerPayoutFeePercentageRate: metadata.providerPayoutFeePercentageRate,
          capabilities: metadata.capabilities,
          healthStatus: input.healthStatus
        }
      }
    });

    const updated = await tx.gatewayConfig.findUniqueOrThrow({
      where: { provider },
      include: providerInclude
    });

    return withProviderRuntimeMetadata(updated);
  });
}

function resolveProviderBaseUrl(
  provider: GatewayProvider,
  input: {
    baseUrl?: string;
    mode?: "sandbox" | "live";
  }
) {
  if (provider === "FAPSHI" && input.mode) {
    return input.mode === "live" ? env.FAPSHI_LIVE_BASE_URL : env.FAPSHI_SANDBOX_BASE_URL;
  }

  return input.baseUrl;
}

export async function listProviderCapabilities() {
  const providers = await listProviderConfigs();
  return providers.map((provider) => ({
    provider: provider.provider,
    displayName: provider.displayName,
    isEnabled: provider.isEnabled,
    capabilities: provider.capabilities,
    healthScore: provider.healthScore,
    healthStatus: provider.health?.status ?? "unknown",
    latencyMs: provider.health?.latencyMs ?? null
  }));
}

export async function readProviderBalance(provider: GatewayProvider) {
  const config = await prisma.gatewayConfig.findUnique({
    where: { provider },
    select: {
      provider: true,
      displayName: true,
      isEnabled: true
    }
  });

  if (!config) {
    throw new Error("Provider configuration was not found");
  }

  const balance = await getGatewayBalance(provider);
  return {
    ...config,
    balance
  };
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function withProviderRuntimeMetadata<T extends { provider: GatewayProvider; metadata: Prisma.JsonValue | null; health?: { status: string; latencyMs: number | null } | null }>(
  provider: T
) {
  const capabilities = mergeProviderCapabilities(provider.provider, provider.metadata);
  return {
    ...provider,
    capabilities,
    healthScore: providerHealthScore(provider.health?.status, provider.health?.latencyMs)
  };
}
