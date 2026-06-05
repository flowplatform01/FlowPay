import { GatewayProvider } from "@prisma/client";

export const GATEWAY_PROVIDERS = [
  GatewayProvider.CAMPAY,
  GatewayProvider.MAVIANCE,
  GatewayProvider.CINETPAY,
  GatewayProvider.FLUTTERWAVE,
  GatewayProvider.MONETBIL
] as const;

export type GatewayProviderValue = (typeof GATEWAY_PROVIDERS)[number];

export type ProviderCapability =
  | "LOCAL_MOMO_COLLECTION"
  | "MTN_COLLECTION"
  | "ORANGE_COLLECTION"
  | "CAMEROON_ROUTING"
  | "TELECOM_FALLBACK"
  | "MOBILE_FIRST_COLLECTION"
  | "BANK_RAILS"
  | "GIMAC_INTEROPERABILITY"
  | "ENTERPRISE_UTILITY_EXECUTION"
  | "FRANCOPHONE_REGIONAL_ROUTING"
  | "REGIONAL_DISBURSEMENT"
  | "CARD_PAYMENTS"
  | "SUBACCOUNTS"
  | "PAN_AFRICAN_ROUTING"
  | "NATIVE_SPLIT_SETTLEMENT";

const defaultProviderCapabilities: Record<GatewayProviderValue, ProviderCapability[]> = {
  [GatewayProvider.CAMPAY]: [
    "LOCAL_MOMO_COLLECTION",
    "MTN_COLLECTION",
    "ORANGE_COLLECTION",
    "CAMEROON_ROUTING"
  ],
  [GatewayProvider.MONETBIL]: [
    "LOCAL_MOMO_COLLECTION",
    "TELECOM_FALLBACK",
    "MOBILE_FIRST_COLLECTION",
    "CAMEROON_ROUTING"
  ],
  [GatewayProvider.MAVIANCE]: [
    "BANK_RAILS",
    "GIMAC_INTEROPERABILITY",
    "ENTERPRISE_UTILITY_EXECUTION",
    "LOCAL_MOMO_COLLECTION",
    "CAMEROON_ROUTING"
  ],
  [GatewayProvider.CINETPAY]: [
    "FRANCOPHONE_REGIONAL_ROUTING",
    "REGIONAL_DISBURSEMENT",
    "CARD_PAYMENTS",
    "LOCAL_MOMO_COLLECTION"
  ],
  [GatewayProvider.FLUTTERWAVE]: [
    "SUBACCOUNTS",
    "CARD_PAYMENTS",
    "BANK_RAILS",
    "PAN_AFRICAN_ROUTING",
    "NATIVE_SPLIT_SETTLEMENT"
  ]
};

export function getDefaultProviderCapabilities(provider: GatewayProviderValue) {
  return defaultProviderCapabilities[provider] ?? [];
}

export function mergeProviderCapabilities(provider: GatewayProviderValue, metadata: unknown): string[] {
  const configured = readConfiguredCapabilities(metadata);
  return Array.from(new Set([...getDefaultProviderCapabilities(provider), ...configured]));
}

export function providerSupportsCapability(
  provider: GatewayProviderValue,
  capability: string,
  metadata?: unknown
) {
  return mergeProviderCapabilities(provider, metadata).includes(capability as ProviderCapability);
}

export function providerHealthScore(status?: string | null, latencyMs?: number | null) {
  if (!status || status === "offline" || status === "DOWN") return 0;
  const base = status === "healthy" || status === "UP" ? 100 : 55;
  const latencyPenalty = latencyMs ? Math.min(40, Math.floor(latencyMs / 250)) : 0;
  return Math.max(0, base - latencyPenalty);
}

export function assertProviderCanAcceptTraffic(
  provider: GatewayProviderValue,
  config: {
    isEnabled: boolean;
    health?: { status: string | null; errorMessage?: string | null } | null;
  }
) {
  if (!config.isEnabled) {
    throw new Error(`${provider} is currently disabled for new payment requests`);
  }

  const status = config.health?.status?.toLowerCase();
  if (status === "offline" || status === "down") {
    const reason = config.health?.errorMessage ? `: ${config.health.errorMessage}` : "";
    throw new Error(`${provider} is currently unavailable for new payment requests${reason}`);
  }
}

function readConfiguredCapabilities(metadata: unknown): ProviderCapability[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const capabilities = (metadata as Record<string, unknown>).capabilities;
  if (!Array.isArray(capabilities)) return [];
  return capabilities.filter((capability): capability is ProviderCapability => typeof capability === "string");
}
