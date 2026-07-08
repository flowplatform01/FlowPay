import type { GatewayProvider, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { generateOpaqueKey } from "../../utils/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { CONFIRMATION_GATEWAY_WORKFLOWS } from "../confirmation-gateway/confirmation-gateway.types.js";
import {
  resolveOperationalProviderFromPaymentMethod,
  resolveProviderFromPaymentMethod,
  type PaymentMethodId
} from "../payments/payment-channels.js";

type DestinationProfileInput = {
  appId: string;
  organizationId: string;
  externalRecipientId: string;
  providerType?: GatewayProvider;
  payoutTarget: string;
  nativeSubaccountId?: string | null;
  settlementStrategy: "TWO_STEP_MIRROR" | "NATIVE_SPLIT";
  providerMetadata?: Record<string, unknown>;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  supportedRails?: string[];
  regionalCurrency: string;
  routingPreferences?: Record<string, unknown>;
};

export class DestinationProfileProvisioningError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "DestinationProfileProvisioningError";
  }
}

export async function listDestinationProfiles(appId?: string) {
  const profiles = await prisma.destinationProfile.findMany({
    where: {
      appId,
      deletedAt: null
    },
    orderBy: { createdAt: "desc" }
  });

  const { buildRecipientConfirmationUrl } = await import("./recipient-confirmation.service.js");

  return profiles.map((profile) => ({
    ...profile,
    ...(profile.confirmationToken
      ? {
          confirmationUrl: buildRecipientConfirmationUrl(profile.id, profile.confirmationToken)
        }
      : {})
  }));
}

export async function upsertDestinationProfile(input: DestinationProfileInput) {
  if (!input.providerType) {
    throw new DestinationProfileProvisioningError("Destination provider could not be resolved", 400);
  }

  const serialized = serializeDestinationProfileInput(input);
  const profile = await prisma.destinationProfile.upsert({
    where: {
      appId_externalRecipientId: {
        appId: input.appId,
        externalRecipientId: input.externalRecipientId
      }
    },
    update: serialized,
    create: {
      appId: input.appId,
      organizationId: input.organizationId,
      externalRecipientId: input.externalRecipientId,
      providerType: input.providerType,
      payoutTarget: input.payoutTarget,
      nativeSubaccountId: input.nativeSubaccountId ?? null,
      settlementStrategy: input.settlementStrategy,
      providerMetadata: input.providerMetadata as Prisma.InputJsonValue | undefined,
      verificationStatus: input.verificationStatus,
      supportedRails: input.supportedRails as Prisma.InputJsonValue | undefined,
      regionalCurrency: input.regionalCurrency.toUpperCase(),
      routingPreferences: input.routingPreferences as Prisma.InputJsonValue | undefined
    }
  });

  await recordAuditEvent({
    action: "destination_profile.upserted",
    entityType: "DestinationProfile",
    entityId: profile.id,
    payload: {
      appId: input.appId,
      externalRecipientId: input.externalRecipientId,
      providerType: input.providerType,
      settlementStrategy: input.settlementStrategy,
      verificationStatus: input.verificationStatus
    }
  });

  return profile;
}

export async function provisionDestinationProfileForApp(
  appId: string,
  input: Omit<DestinationProfileInput, "appId" | "organizationId" | "verificationStatus"> & {
    verificationStatus?: DestinationProfileInput["verificationStatus"];
  }
) {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    include: {
      providerAccesses: true,
      destinationProfiles: {
        where: { deletedAt: null },
        select: {
          id: true,
          externalRecipientId: true,
          providerType: true,
          payoutTarget: true,
          verificationStatus: true
        }
      }
    }
  });

  if (!app || app.status !== "ACTIVE") {
    throw new DestinationProfileProvisioningError("Application is not active", 403);
  }

  if (!app.destinationProfileProvisioningEnabled) {
    throw new DestinationProfileProvisioningError("Recipient provisioning is not enabled for this application", 403);
  }

  const resolvedProviderType =
    input.providerType ??
    await resolveOperationalProviderFromPaymentMethod(resolvePreferredPaymentMethod(input.routingPreferences), {
      appProviderAccesses: app.providerAccesses
    });

  const providerAccess = app.providerAccesses.find((provider) => provider.provider === resolvedProviderType);
  if (!providerAccess?.isEnabled) {
    throw new DestinationProfileProvisioningError(`${resolvedProviderType} is not enabled for this application`, 403);
  }

  const existing = app.destinationProfiles.find((profile) => profile.externalRecipientId === input.externalRecipientId);
  const isNewRecipientSlot =
    !existing || existing.verificationStatus === "REJECTED" || existing.verificationStatus === "SUSPENDED";

  if (isNewRecipientSlot) {
    const { assertRecipientCapacityEligible } = await import("../capacity-policy/capacity-policy.service.js");
    await assertRecipientCapacityEligible({ appId, forActivation: false });
  }

  const limit = app.destinationProfileLimit;
  const targetChanged =
    existing &&
    (existing.providerType !== resolvedProviderType || existing.payoutTarget !== input.payoutTarget);
  const verificationStatus =
    app.destinationProfileAutoVerifyEnabled || (existing?.verificationStatus === "VERIFIED" && !targetChanged)
      ? "VERIFIED"
      : "PENDING";

  const profile = await upsertDestinationProfile({
    appId,
    organizationId: app.organizationId,
    ...input,
    providerType: resolvedProviderType,
    verificationStatus
  });

  let confirmation = null;

  if (profile.verificationStatus === "PENDING") {
    try {
      const { createRecipientConfirmationSession } = await import("./recipient-confirmation.service.js");
      confirmation = await createRecipientConfirmationSession(profile.id);
    } catch (err) {
      console.error("Failed to create recipient confirmation session", err);
    }
  }

  await recordAuditEvent({
    action: "destination_profile.provisioned_by_app",
    actorType: "APP",
    actorId: appId,
    entityType: "DestinationProfile",
    entityId: profile.id,
    payload: {
      externalRecipientId: profile.externalRecipientId,
      providerType: profile.providerType,
      requestedPaymentMethod: resolvePreferredPaymentMethod(input.routingPreferences),
      verificationStatus: profile.verificationStatus,
      autoVerified: app.destinationProfileAutoVerifyEnabled,
      targetChanged: Boolean(targetChanged),
      profileLimit: limit
    }
  });

  return {
    ...profile,
    confirmationToken: confirmation?.token ?? undefined
  };
}

export async function updateDestinationProfile(
  id: string,
  input: Partial<Omit<DestinationProfileInput, "appId" | "organizationId">>
) {
  const data: Prisma.DestinationProfileUpdateInput = {};

  if (input.externalRecipientId !== undefined) data.externalRecipientId = input.externalRecipientId;
  if (input.providerType !== undefined) data.providerType = input.providerType;
  if (input.payoutTarget !== undefined) data.payoutTarget = input.payoutTarget;
  if (input.nativeSubaccountId !== undefined) data.nativeSubaccountId = input.nativeSubaccountId;
  if (input.settlementStrategy !== undefined) data.settlementStrategy = input.settlementStrategy;
  if (input.providerMetadata !== undefined) data.providerMetadata = input.providerMetadata as Prisma.InputJsonValue;
  if (input.verificationStatus !== undefined) data.verificationStatus = input.verificationStatus;
  if (input.supportedRails !== undefined) data.supportedRails = input.supportedRails as Prisma.InputJsonValue;
  if (input.regionalCurrency !== undefined) data.regionalCurrency = input.regionalCurrency.toUpperCase();
  if (input.routingPreferences !== undefined) data.routingPreferences = input.routingPreferences as Prisma.InputJsonValue;

  const profile = await prisma.destinationProfile.update({
    where: { id },
    data
  });

  await recordAuditEvent({
    action: "destination_profile.updated",
    entityType: "DestinationProfile",
    entityId: profile.id,
    payload: {
      externalRecipientId: profile.externalRecipientId,
      providerType: profile.providerType,
      settlementStrategy: profile.settlementStrategy,
      verificationStatus: profile.verificationStatus
    }
  });

  return profile;
}

export async function resolveDestinationProfile(appId: string, externalRecipientId?: string) {
  if (!externalRecipientId) {
    return null;
  }

  const profile = await prisma.destinationProfile.findFirst({
    where: {
      appId,
      externalRecipientId,
      deletedAt: null
    }
  });

  if (!profile) {
    throw new Error("Destination profile was not found for external_recipient_id");
  }

  if (profile.verificationStatus !== "VERIFIED") {
    throw new Error("Destination profile is not verified for orchestration");
  }

  return profile;
}

export async function getDestinationProfileForApp(appId: string, externalRecipientId: string) {
  const profile = await prisma.destinationProfile.findFirst({
    where: {
      appId,
      externalRecipientId,
      deletedAt: null
    },
    select: {
      id: true,
      externalRecipientId: true,
      verificationStatus: true,
      regionalCurrency: true,
      updatedAt: true
    }
  });

  if (!profile) {
    throw new Error("Destination profile not found");
  }

  return profile;
}

export async function initiateRecipientVerificationPayment(input: {
  appId: string;
  externalRecipientId: string;
  paymentMethod?: PaymentMethodId;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}) {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: input.appId },
    include: {
      organization: true,
      providerAccesses: true,
      capabilities: true
    }
  });

  if (app.status !== "ACTIVE") {
    throw new DestinationProfileProvisioningError("Application is not active", 403);
  }

  if (!app.recipientVerificationPaymentEnabled) {
    throw new DestinationProfileProvisioningError("Recipient verification payment is not enabled for this application", 403);
  }

  const profile = await prisma.destinationProfile.findFirst({
    where: {
      appId: input.appId,
      externalRecipientId: input.externalRecipientId,
      deletedAt: null
    }
  });

  if (!profile) {
    throw new DestinationProfileProvisioningError("Recipient profile was not found", 404);
  }

  if (profile.verificationStatus === "VERIFIED") {
    throw new DestinationProfileProvisioningError("Recipient profile is already verified", 409);
  }

  if (["REJECTED", "SUSPENDED"].includes(profile.verificationStatus)) {
    throw new DestinationProfileProvisioningError(`Recipient profile is ${profile.verificationStatus.toLowerCase()}`, 403);
  }

  const provider = input.paymentMethod
    ? resolveProviderFromPaymentMethod(input.paymentMethod)
    : profile.providerType;

  const providerAccess = app.providerAccesses.find((access) => access.provider === provider);
  if (providerAccess && !providerAccess.isEnabled) {
    throw new DestinationProfileProvisioningError(`${provider} is not enabled for this application`, 403);
  }

  const amountXaf = Number(app.recipientVerificationAmountXaf);
  if (!Number.isFinite(amountXaf) || amountXaf <= 0) {
    throw new DestinationProfileProvisioningError("Recipient verification amount is not configured correctly", 500);
  }

  const idempotencyKey = generateOpaqueKey("rverify");
  const displayName = readProfileDisplayName(profile.providerMetadata) ?? profile.externalRecipientId;
  const { createTransaction } = await import("../transactions/transactions.service.js");

  const transaction = await createTransaction({
    appId: app.id,
    organizationId: app.organizationId,
    idempotencyKey,
    externalReference: `recipient-verification-${profile.id}-${Date.now()}`,
    amount: amountXaf,
    currency: "XAF",
    provider,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    deferCapture: true,
    appProfile: app,
    metadata: {
      __flowpay_recipient_verification: true,
      __flowpay_confirmation_gateway: CONFIRMATION_GATEWAY_WORKFLOWS.RECIPIENT_VERIFICATION,
      recipientVerificationProfileId: profile.id,
      externalRecipientId: profile.externalRecipientId,
      recipientName: displayName,
      checkoutDescription: `Verify saved recipient ${displayName}`
    }
  });

  await recordAuditEvent({
    action: "destination_profile.verification_payment_initialized",
    actorType: "APP",
    actorId: app.id,
    entityType: "DestinationProfile",
    entityId: profile.id,
    payload: {
      transactionId: transaction.id,
      externalRecipientId: profile.externalRecipientId,
      provider,
      amountXaf
    }
  });

  return transaction;
}

export async function maybeFinalizeRecipientVerificationFromTransaction(transaction: {
  id: string;
  appId?: string;
  status: string;
  metadata: unknown;
  failureReason?: string | null;
}) {
  const metadata = readRecipientVerificationMetadata(transaction.metadata);
  if (!metadata) {
    return;
  }

  if (transaction.status === "SUCCEEDED") {
    const profile = await prisma.destinationProfile.update({
      where: { id: metadata.recipientVerificationProfileId },
      data: {
        verificationStatus: "VERIFIED",
        confirmationToken: null,
        confirmationTokenExpiresAt: null
      }
    });

    await recordAuditEvent({
      action: "destination_profile.verified_by_payment",
      actorType: "INTERNAL_SERVICE",
      entityType: "DestinationProfile",
      entityId: profile.id,
      payload: {
        transactionId: transaction.id,
        externalRecipientId: profile.externalRecipientId
      }
    });
    return;
  }

  if (transaction.status === "FAILED") {
    await recordAuditEvent({
      action: "destination_profile.verification_payment_failed",
      actorType: "INTERNAL_SERVICE",
      entityType: "DestinationProfile",
      entityId: metadata.recipientVerificationProfileId,
      payload: {
        transactionId: transaction.id,
        reason: transaction.failureReason ?? "Verification payment failed"
      }
    });
  }
}

function serializeDestinationProfileInput(input: DestinationProfileInput): Prisma.DestinationProfileUncheckedUpdateInput {
  return {
    providerType: input.providerType,
    payoutTarget: input.payoutTarget,
    nativeSubaccountId: input.nativeSubaccountId ?? null,
    settlementStrategy: input.settlementStrategy,
    providerMetadata: input.providerMetadata as Prisma.InputJsonValue | undefined,
    verificationStatus: input.verificationStatus,
    supportedRails: input.supportedRails as Prisma.InputJsonValue | undefined,
    regionalCurrency: input.regionalCurrency.toUpperCase(),
    routingPreferences: input.routingPreferences as Prisma.InputJsonValue | undefined,
    deletedAt: null
  };
}

function readProfileDisplayName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).displayName;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolvePreferredPaymentMethod(routingPreferences?: Record<string, unknown>): PaymentMethodId {
  const preferred = routingPreferences?.preferredMethod;
  if (
    preferred === "MTN_MOMO" ||
    preferred === "ORANGE_MONEY" ||
    preferred === "CARD_PAYMENT" ||
    preferred === "BANK_TRANSFER"
  ) {
    return preferred;
  }

  return "MTN_MOMO";
}

function readRecipientVerificationMetadata(
  metadata: unknown
): { recipientVerificationProfileId: string } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  if (record.__flowpay_recipient_verification !== true) {
    return null;
  }

  if (typeof record.recipientVerificationProfileId !== "string") {
    return null;
  }

  return { recipientVerificationProfileId: record.recipientVerificationProfileId };
}
