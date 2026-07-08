import { prisma } from "../../config/db.js";
import { generateOpaqueKey } from "../../utils/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { env } from "../../config/env.js";
import { normalizePhoneNumber } from "../../utils/phone.js";
import {
  serializeRecipientConfirmationSession,
  validateEditablePayoutTarget
} from "../confirmation-gateway/confirmation-gateway.service.js";
import {
  assertRecipientCapacityEligible,
  CapacityEligibilityError,
  evaluateCapacityEligibility,
  serializeCapacityEligibilityForConsumer
} from "../capacity-policy/capacity-policy.service.js";

const TOKEN_EXPIRY_HOURS = 24;

export async function createRecipientConfirmationSession(
  destinationProfileId: string
) {
  const token = generateOpaqueKey("conf");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

  const profile = await prisma.destinationProfile.update({
    where: { id: destinationProfileId },
    data: {
      confirmationToken: token,
      confirmationTokenExpiresAt: expiresAt,
      confirmationRequestedAt: new Date(),
      verificationStatus: "PENDING"
    },
    select: {
      id: true,
      externalRecipientId: true,
      payoutTarget: true,
      providerType: true,
      app: {
        select: {
          name: true,
          slug: true
        }
      }
    }
  });

  await recordAuditEvent({
    action: "destination_profile.confirmation_requested",
    actorType: "INTERNAL_SERVICE",
    entityType: "DestinationProfile",
    entityId: destinationProfileId,
    payload: {
      externalRecipientId: profile.externalRecipientId,
      expiresAt
    }
  });

  return {
    token,
    expiresAt,
    profile
  };
}

export function buildRecipientConfirmationUrl(profileId: string, token: string) {
  const base = env.FLOWPAY_PUBLIC_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ token });
  return `${base}/recipient-confirm/${profileId}?${params.toString()}`;
}

export async function getRecipientConfirmationSession(
  destinationProfileId: string,
  token: string
) {
  const profile = await prisma.destinationProfile.findUnique({
    where: { id: destinationProfileId },
    include: {
      app: {
        select: { id: true, name: true, slug: true }
      },
      organization: {
        select: { name: true, slug: true }
      }
    }
  });

  if (!profile) {
    throw new Error("Destination profile not found");
  }

  if (profile.confirmationToken !== token) {
    throw new Error("Invalid confirmation token");
  }

  if (
    !profile.confirmationTokenExpiresAt ||
    profile.confirmationTokenExpiresAt < new Date()
  ) {
    throw new Error("Confirmation token has expired");
  }

  const eligibility = await evaluateCapacityEligibility({
    appId: profile.appId,
    resourceType: "RECIPIENT",
    excludeProfileId: profile.id
  });

  return {
    ...serializeRecipientConfirmationSession(profile),
    capacityEligibility: serializeCapacityEligibilityForConsumer(eligibility)
  };
}

export async function approveRecipientConfirmation(
  destinationProfileId: string,
  token: string,
  input: { payoutTarget?: string } = {}
) {
  const profileRecord = await prisma.destinationProfile.findUniqueOrThrow({
    where: { id: destinationProfileId },
    select: { appId: true, confirmationToken: true, confirmationTokenExpiresAt: true }
  });

  const session = await getRecipientConfirmationSession(destinationProfileId, token);

  if (!session.capacityEligibility.canActivate) {
    throw new CapacityEligibilityError(
      session.capacityEligibility.reasons[0] ?? "Recipient activation requirements are not met.",
      409
    );
  }

  await assertRecipientCapacityEligible({
    appId: profileRecord.appId,
    excludeProfileId: destinationProfileId,
    forActivation: true
  });

  let payoutTarget = session.payoutTarget;
  if (input.payoutTarget !== undefined) {
    const validated = validateEditablePayoutTarget(input.payoutTarget);
    payoutTarget = normalizePhoneNumber(validated) ?? validated;
  }

  const profile = await prisma.destinationProfile.update({
    where: { id: destinationProfileId },
    data: {
      payoutTarget,
      verificationStatus: "VERIFIED",
      confirmationToken: null,
      confirmationTokenExpiresAt: null
    }
  });

  await recordAuditEvent({
    action: "destination_profile.confirmation_approved",
    actorType: "RECIPIENT",
    entityType: "DestinationProfile",
    entityId: destinationProfileId,
    payload: {
      externalRecipientId: profile.externalRecipientId,
      payoutTarget: profile.payoutTarget,
      payoutTargetCorrected: payoutTarget !== session.payoutTarget
    }
  });

  return profile;
}

export async function rejectRecipientConfirmation(
  destinationProfileId: string,
  token: string,
  input: { reason?: string } = {}
) {
  await getRecipientConfirmationSession(destinationProfileId, token);

  const profile = await prisma.destinationProfile.update({
    where: { id: destinationProfileId },
    data: {
      verificationStatus: "REJECTED",
      confirmationToken: null,
      confirmationTokenExpiresAt: null
    }
  });

  await recordAuditEvent({
    action: "destination_profile.confirmation_rejected",
    actorType: "RECIPIENT",
    entityType: "DestinationProfile",
    entityId: destinationProfileId,
    payload: {
      externalRecipientId: profile.externalRecipientId,
      reason: input.reason ?? null
    }
  });

  return profile;
}
