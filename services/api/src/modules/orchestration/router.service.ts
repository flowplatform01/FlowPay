import type { DestinationProfile, GatewayProvider, SettlementStrategy } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { resolveDestinationProfile } from "../destination-profiles/destination-profiles.service.js";
import { mergeProviderCapabilities } from "../providers/provider-registry.js";

export type OrchestrationRoute = {
  mode: "PLATFORM_REVENUE" | "MULTI_TENANT";
  provider: GatewayProvider;
  settlementStrategy: SettlementStrategy;
  destinationProfile: DestinationProfile | null;
  externalRecipientId?: string;
};

export async function resolveOrchestrationRoute(input: {
  appId: string;
  requestedProvider: GatewayProvider;
  externalRecipientId?: string;
}): Promise<OrchestrationRoute> {
  const destinationProfile = await resolveDestinationProfile(input.appId, input.externalRecipientId);

  if (!destinationProfile) {
    return {
      mode: "PLATFORM_REVENUE",
      provider: input.requestedProvider,
      settlementStrategy: "TWO_STEP_MIRROR",
      destinationProfile: null
    };
  }

  await assertProviderSupportsDestinationProfile(destinationProfile);

  return {
    mode: "MULTI_TENANT",
    provider: destinationProfile.providerType,
    settlementStrategy: destinationProfile.settlementStrategy,
    destinationProfile,
    externalRecipientId: destinationProfile.externalRecipientId
  };
}

const gatewayMetadataCache = new Map<string, { expiresAt: number; metadata: any }>();
const GATEWAY_CACHE_TTL_MS = 30_000;

async function assertProviderSupportsDestinationProfile(destinationProfile: DestinationProfile) {
  let gatewayMetadata: any = null;
  const cached = gatewayMetadataCache.get(destinationProfile.providerType);
  
  if (cached && cached.expiresAt > Date.now()) {
    gatewayMetadata = cached.metadata;
  } else {
    const gateway = await prisma.gatewayConfig.findUnique({
      where: { provider: destinationProfile.providerType },
      select: { metadata: true }
    });
    gatewayMetadata = gateway?.metadata;
    gatewayMetadataCache.set(destinationProfile.providerType, {
      expiresAt: Date.now() + GATEWAY_CACHE_TTL_MS,
      metadata: gatewayMetadata
    });
  }

  const capabilities = mergeProviderCapabilities(destinationProfile.providerType, gatewayMetadata);
  const requiredCapabilities = resolveRequiredCapabilities(destinationProfile);
  const missing = requiredCapabilities.filter((capability) => !capabilities.includes(capability));

  if (missing.length) {
    throw new Error(
      `${destinationProfile.providerType} does not support required orchestration capabilities: ${missing.join(", ")}`
    );
  }
}

function resolveRequiredCapabilities(destinationProfile: DestinationProfile) {
  const required = new Set<string>();
  const supportedRails = Array.isArray(destinationProfile.supportedRails)
    ? destinationProfile.supportedRails.filter((rail): rail is string => typeof rail === "string")
    : [];

  for (const rail of supportedRails) {
    for (const capability of capabilitiesForRail(rail)) {
      required.add(capability);
    }
  }

  if (destinationProfile.settlementStrategy === "NATIVE_SPLIT") {
    required.add("NATIVE_SPLIT_SETTLEMENT");
  }

  return [...required];
}

function capabilitiesForRail(rail: string) {
  const normalized = rail.trim().toUpperCase();

  if (normalized === "MOBILE_MONEY" || normalized === "MOMO") {
    return ["LOCAL_MOMO_COLLECTION"];
  }

  if (normalized === "MTN_MOMO" || normalized === "MTN_MOBILE_MONEY") {
    return ["MTN_COLLECTION"];
  }

  if (normalized === "ORANGE_MONEY") {
    return ["ORANGE_COLLECTION"];
  }

  if (normalized === "CARD" || normalized === "CARD_PAYMENT") {
    return ["CARD_PAYMENTS"];
  }

  if (normalized === "BANK_TRANSFER") {
    return ["BANK_RAILS"];
  }

  return [normalized];
}

export function buildDestinationSnapshot(destinationProfile: DestinationProfile | null) {
  if (!destinationProfile) return undefined;

  return {
    externalRecipientId: destinationProfile.externalRecipientId,
    providerType: destinationProfile.providerType,
    payoutTarget: destinationProfile.payoutTarget,
    nativeSubaccountId: destinationProfile.nativeSubaccountId,
    settlementStrategy: destinationProfile.settlementStrategy,
    regionalCurrency: destinationProfile.regionalCurrency
  };
}
