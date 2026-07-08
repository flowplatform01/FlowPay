import type { GatewayProvider } from "@prisma/client";
import { getPaymentMethodForProvider } from "../payments/payment-channels.js";
import {
  CONFIRMATION_GATEWAY_WORKFLOWS,
  type ConfirmationGatewayWorkflow,
  type RecipientConfirmationSessionView
} from "./confirmation-gateway.types.js";

export function isConfirmationGatewayWorkflow(value: unknown): value is ConfirmationGatewayWorkflow {
  return (
    value === CONFIRMATION_GATEWAY_WORKFLOWS.RECIPIENT_SETUP ||
    value === CONFIRMATION_GATEWAY_WORKFLOWS.CREDIT_TOPUP ||
    value === CONFIRMATION_GATEWAY_WORKFLOWS.RECIPIENT_VERIFICATION
  );
}

export function resolvePublicPaymentRailLabel(input: {
  providerType: GatewayProvider;
  supportedRails?: unknown;
  routingPreferences?: unknown;
}) {
  const preferredMethod =
    input.routingPreferences &&
    typeof input.routingPreferences === "object" &&
    !Array.isArray(input.routingPreferences)
      ? (input.routingPreferences as Record<string, unknown>).preferredMethod
      : undefined;

  if (typeof preferredMethod === "string" && preferredMethod.length > 0) {
    const normalized = preferredMethod.toUpperCase();
    if (normalized.includes("ORANGE")) return "Orange Money";
    if (normalized.includes("MTN")) return "MTN Mobile Money";
    if (normalized.includes("BANK")) return "Bank Transfer";
    if (normalized.includes("CARD")) return "Card Payment";
  }

  return getPaymentMethodForProvider(input.providerType).label;
}

export function serializeRecipientConfirmationSession(profile: {
  id: string;
  externalRecipientId: string;
  payoutTarget: string;
  providerType: GatewayProvider;
  regionalCurrency: string;
  providerMetadata: unknown;
  supportedRails: unknown;
  routingPreferences: unknown;
  app: { name: string; slug: string };
  organization: { name: string; slug: string };
}): RecipientConfirmationSessionView {
  const displayName =
    profile.providerMetadata &&
    typeof profile.providerMetadata === "object" &&
    !Array.isArray(profile.providerMetadata)
      ? String((profile.providerMetadata as Record<string, unknown>).displayName ?? "") || null
      : null;

  return {
    id: profile.id,
    workflow: CONFIRMATION_GATEWAY_WORKFLOWS.RECIPIENT_SETUP,
    externalRecipientId: profile.externalRecipientId,
    displayName,
    payoutTarget: profile.payoutTarget,
    paymentRailLabel: resolvePublicPaymentRailLabel(profile),
    regionalCurrency: profile.regionalCurrency,
    editableFields: ["payoutTarget"],
    app: profile.app,
    organization: profile.organization
  };
}

export function validateEditablePayoutTarget(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length < 6) {
    throw new Error("Payout target must be at least 6 characters");
  }

  if (normalized.length > 80) {
    throw new Error("Payout target is too long");
  }

  const phoneLike = /^\+?[0-9]{9,15}$/.test(normalized.replace(/[\s().-]+/g, ""));
  const accountLike = /^[A-Za-z0-9+./@_-]{6,80}$/.test(normalized);

  if (!phoneLike && !accountLike) {
    throw new Error("Enter a valid wallet number or payout account reference");
  }

  return normalized;
}
