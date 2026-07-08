import { GatewayProvider } from "@prisma/client";
import type { GatewayConfig, GatewayHealth, AppProviderAccess } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { providerHasOperationalRuntime } from "../providers/provider-registry.js";

export const PAYMENT_METHODS = [
  {
    id: "MTN_MOMO",
    label: "MTN Mobile Money",
    type: "Mobile Money",
    defaultFee: 0,
    providers: [GatewayProvider.FAPSHI, GatewayProvider.CAMPAY]
  },
  {
    id: "ORANGE_MONEY",
    label: "Orange Money",
    type: "Mobile Money",
    defaultFee: 0,
    providers: [GatewayProvider.FAPSHI, GatewayProvider.MAVIANCE]
  },
  {
    id: "CARD_PAYMENT",
    label: "Card Payment",
    type: "Cards",
    defaultFee: 0,
    providers: [GatewayProvider.CINETPAY]
  },
  {
    id: "BANK_TRANSFER",
    label: "Bank Transfer",
    type: "Bank Transfer",
    defaultFee: 0,
    providers: [GatewayProvider.CINETPAY]
  }
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];
export type PublicPaymentMethod = {
  id: PaymentMethodId;
  label: string;
  type: string;
  fee: number;
  available: boolean;
  unavailableReason?: string;
};

const methodById = new Map(PAYMENT_METHODS.map((method) => [method.id, method]));

export function resolveProviderFromPaymentMethod(paymentMethod: string): GatewayProvider {
  const method = methodById.get(paymentMethod as PaymentMethodId);
  if (!method) {
    throw new Error("Unsupported payment method");
  }

  return chooseProviderForMethod(method.providers);
}

export async function resolveOperationalProviderFromPaymentMethod(
  paymentMethod: string,
  options?: {
    appProviderAccesses?: Array<Pick<AppProviderAccess, "provider" | "isEnabled" | "priority">>;
  }
): Promise<GatewayProvider> {
  const method = methodById.get(paymentMethod as PaymentMethodId);
  if (!method) {
    throw new Error("Unsupported payment method");
  }

  const providers = [...method.providers];
  const configs = await prisma.gatewayConfig.findMany({
    where: { provider: { in: providers } },
    include: { health: true }
  });
  const configByProvider = new Map(configs.map((config) => [config.provider, config]));
  const accessByProvider = new Map(
    (options?.appProviderAccesses ?? []).map((access) => [access.provider, access])
  );

  const candidates = providers
    .map((provider) => ({
      provider,
      config: configByProvider.get(provider),
      access: accessByProvider.get(provider)
    }))
    .filter(({ provider, config, access }) => {
      const healthStatus = config?.health?.status?.toLowerCase();
      return (
        providerHasOperationalRuntime(provider) &&
        Boolean(config?.isEnabled) &&
        access?.isEnabled !== false &&
        healthStatus !== "offline" &&
        healthStatus !== "down"
      );
    })
    .sort((left, right) => providerRouteScore(left) - providerRouteScore(right));

  if (!candidates.length) {
    throw new Error("No operational provider is configured for this payment method");
  }

  return candidates[0].provider;
}

export function getPaymentMethodForProvider(provider: GatewayProvider) {
  return PAYMENT_METHODS.find((method) => (method.providers as readonly GatewayProvider[]).includes(provider)) ?? PAYMENT_METHODS[0];
}

export function listPublicPaymentMethods(provider?: GatewayProvider) {
  const methods = provider
    ? PAYMENT_METHODS.filter((method) => (method.providers as readonly GatewayProvider[]).includes(provider))
    : PAYMENT_METHODS;

  return methods.map(({ id, label, type, defaultFee }) => ({
    id,
    label,
    type,
    fee: defaultFee,
    available: provider
      ? providerHasOperationalRuntime(provider)
      : providersHaveOperationalRuntime(methodById.get(id)?.providers ?? []),
    unavailableReason: provider
      ? providerHasOperationalRuntime(provider)
        ? undefined
        : "This payment method is currently unavailable."
      : providersHaveOperationalRuntime(methodById.get(id)?.providers ?? [])
        ? undefined
        : "This payment method is currently unavailable."
  }));
}

export async function listCheckoutPaymentMethods(provider?: GatewayProvider): Promise<PublicPaymentMethod[]> {
  const providerSet = new Set<GatewayProvider>();
  for (const method of PAYMENT_METHODS) {
    const candidates = provider
      ? (method.providers as readonly GatewayProvider[]).includes(provider)
        ? [provider]
        : []
      : method.providers;

    for (const candidate of candidates) {
      providerSet.add(candidate);
    }
  }

  const configs = providerSet.size
    ? await prisma.gatewayConfig.findMany({
        where: { provider: { in: Array.from(providerSet) } },
        include: { health: true }
      })
    : [];
  const configByProvider = new Map(configs.map((config) => [config.provider, config]));

  return PAYMENT_METHODS.map(({ id, label, type, defaultFee, providers }) => {
    const candidates = provider
      ? (providers as readonly GatewayProvider[]).includes(provider)
        ? [provider]
        : []
      : providers;

    const available = candidates.some((candidate) => {
      const config = configByProvider.get(candidate);
      const healthStatus = config?.health?.status?.toLowerCase();

      return (
        providerHasOperationalRuntime(candidate) &&
        Boolean(config?.isEnabled) &&
        healthStatus !== "offline" &&
        healthStatus !== "down"
      );
    });

    return {
      id,
      label,
      type,
      fee: defaultFee,
      available,
      unavailableReason: available
        ? undefined
        : "This payment method is currently unavailable."
    };
  });
}

function chooseProviderForMethod(providers: readonly GatewayProvider[]) {
  if (
    providers.includes(GatewayProvider.FAPSHI) &&
    providerHasOperationalRuntime(GatewayProvider.FAPSHI)
  ) {
    return GatewayProvider.FAPSHI;
  }

  const operationalProvider = providers.find((provider) => providerHasOperationalRuntime(provider));
  if (!operationalProvider) {
    throw new Error("No operational provider is configured for this payment method");
  }

  return operationalProvider;
}

function providersHaveOperationalRuntime(providers: readonly GatewayProvider[]) {
  return providers.some((provider) => providerHasOperationalRuntime(provider));
}

function providerRouteScore(input: {
  provider: GatewayProvider;
  config?: (GatewayConfig & { health: GatewayHealth | null }) | null;
  access?: Pick<AppProviderAccess, "priority"> | null;
}) {
  const metadata = asRecord(input.config?.metadata);
  const strategy = String(metadata.routeStrategy ?? "").toLowerCase();
  const strategyScore = strategy === "primary" ? 0 : strategy === "failover" ? 20 : strategy === "standby" ? 40 : 30;
  const appPriority = Number.isFinite(input.access?.priority) ? Number(input.access?.priority) : 100;
  const defaultProviderBias = input.provider === GatewayProvider.FAPSHI ? 0 : 5;
  return strategyScore + appPriority + defaultProviderBias;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
