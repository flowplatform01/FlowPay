import type { GatewayProvider, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { recordAuditEvent } from "../audit/audit.service.js";

type DestinationProfileInput = {
  appId: string;
  organizationId: string;
  externalRecipientId: string;
  providerType: GatewayProvider;
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

  const providerAccess = app.providerAccesses.find((provider) => provider.provider === input.providerType);
  if (!providerAccess?.isEnabled) {
    throw new DestinationProfileProvisioningError(`${input.providerType} is not enabled for this application`, 403);
  }

  const existing = app.destinationProfiles.find((profile) => profile.externalRecipientId === input.externalRecipientId);
  const limit = app.destinationProfileLimit;

  if (!existing && limit <= 0) {
    throw new DestinationProfileProvisioningError(
      "Recipient profile limit is not configured for this application",
      409
    );
  }

  if (!existing && app.destinationProfiles.length >= limit) {
    throw new DestinationProfileProvisioningError(
      `Recipient profile limit reached for this application (${limit})`,
      409
    );
  }

  const targetChanged =
    existing &&
    (existing.providerType !== input.providerType || existing.payoutTarget !== input.payoutTarget);
  const verificationStatus =
    app.destinationProfileAutoVerifyEnabled || (existing?.verificationStatus === "VERIFIED" && !targetChanged)
      ? "VERIFIED"
      : "PENDING";

  const profile = await upsertDestinationProfile({
    appId,
    organizationId: app.organizationId,
    ...input,
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
