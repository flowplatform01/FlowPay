import { GatewayProvider } from "@prisma/client";
import { env } from "../../config/env.js";
import type { GatewayAdapter } from "./gateway.types.js";
import { SandboxGatewayAdapter } from "./adapters/sandbox.adapter.js";
import { createCampayAdapter } from "./adapters/campay.adapter.js";
import { createFapshiAdapter } from "./adapters/fapshi.adapter.js";
import { createCinetpayAdapter } from "./adapters/cinetpay.adapter.js";
import { createMavianceAdapter } from "./adapters/maviance.adapter.js";
import { GATEWAY_PROVIDERS } from "../providers/provider-registry.js";

function fallbackAdapter(provider: GatewayProvider): GatewayAdapter {
  const secret =
    provider === GatewayProvider.CAMPAY
      ? env.CAMPAY_WEBHOOK_SECRET || env.WEBHOOK_SIGNING_SECRET
      : provider === GatewayProvider.FAPSHI
        ? env.FAPSHI_WEBHOOK_SECRET || env.WEBHOOK_SIGNING_SECRET
      : provider === GatewayProvider.MAVIANCE
        ? env.MAVIANCE_SECRET_KEY || env.WEBHOOK_SIGNING_SECRET
        : provider === GatewayProvider.CINETPAY
          ? env.CINETPAY_SECRET_KEY || env.WEBHOOK_SIGNING_SECRET
          : env.WEBHOOK_SIGNING_SECRET;

  return new SandboxGatewayAdapter(provider, secret);
}

function createAdapter(provider: GatewayProvider): GatewayAdapter {
  if (provider === GatewayProvider.CAMPAY) {
    return createCampayAdapter() ?? fallbackAdapter(provider);
  }

  if (provider === GatewayProvider.FAPSHI) {
    return createFapshiAdapter() ?? fallbackAdapter(provider);
  }

  if (provider === GatewayProvider.CINETPAY) {
    return createCinetpayAdapter() ?? fallbackAdapter(provider);
  }

  if (provider === GatewayProvider.MAVIANCE) {
    return createMavianceAdapter() ?? fallbackAdapter(provider);
  }

  return fallbackAdapter(provider);
}

const adapters: Record<GatewayProvider, GatewayAdapter> = Object.fromEntries(
  GATEWAY_PROVIDERS.map((provider) => [provider, createAdapter(provider)])
) as Record<GatewayProvider, GatewayAdapter>;

export function getGatewayAdapter(provider: GatewayProvider) {
  return adapters[provider];
}

export async function getGatewayBalance(provider: GatewayProvider) {
  const adapter = adapters[provider];
  if (!adapter.getBalance) {
    return {
      provider,
      supported: false,
      message: "Provider balance lookup is not supported by this adapter"
    };
  }

  const balance = await adapter.getBalance();
  return {
    provider,
    supported: true,
    ...balance
  };
}

export function getActiveAdapterMode(provider: GatewayProvider) {
  const adapter = adapters[provider];
  return adapter instanceof SandboxGatewayAdapter ? "internal-sandbox" : "provider-runtime";
}
