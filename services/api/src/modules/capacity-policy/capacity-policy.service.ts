import type { CapacityResourceType } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { getCreditBalance } from "../credits/credits.service.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import type {
  AppCapacityOverrideInput,
  CapacityEligibilitySnapshot,
  CapacityPolicyTierInput
} from "./capacity-policy.types.js";

export class CapacityEligibilityError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 409,
    public readonly snapshot?: CapacityEligibilitySnapshot
  ) {
    super(message);
    this.name = "CapacityEligibilityError";
  }
}

const DEFAULT_RECIPIENT_TIERS: CapacityPolicyTierInput[] = [
  {
    tierKey: "tier_1",
    name: "Starter",
    description: "Single recipient operations",
    sortOrder: 1,
    maxCapacity: 1,
    minEffectiveCredit: 10
  },
  {
    tierKey: "tier_2",
    name: "Growth",
    description: "Small recipient portfolio",
    sortOrder: 2,
    maxCapacity: 5,
    minEffectiveCredit: 50
  },
  {
    tierKey: "tier_3",
    name: "Scale",
    description: "Mid-size recipient portfolio",
    sortOrder: 3,
    maxCapacity: 20,
    minEffectiveCredit: 200
  },
  {
    tierKey: "tier_4",
    name: "Enterprise",
    description: "Large recipient portfolio",
    sortOrder: 4,
    maxCapacity: 100,
    minEffectiveCredit: 1000
  },
  {
    tierKey: "tier_5",
    name: "Platform",
    description: "Unlimited recipients within admin cap",
    sortOrder: 5,
    maxCapacity: null,
    minEffectiveCredit: 5000
  }
];

export async function ensureCapacityPolicyDefinitions() {
  for (const resourceType of ["RECIPIENT"] as CapacityResourceType[]) {
    const tiers = resourceType === "RECIPIENT" ? DEFAULT_RECIPIENT_TIERS : [];

    await prisma.capacityPolicyDefinition.upsert({
      where: { resourceType },
      update: {},
      create: {
        resourceType,
        enforcementEnabled: true,
        tiers: {
          create: tiers.map((tier) => ({
            tierKey: tier.tierKey,
            name: tier.name,
            description: tier.description ?? null,
            sortOrder: tier.sortOrder,
            maxCapacity: tier.maxCapacity ?? null,
            minEffectiveCredit: tier.minEffectiveCredit,
            enabled: tier.enabled ?? true
          }))
        }
      }
    });
  }
}

export async function listCapacityPolicyDefinitions() {
  await ensureCapacityPolicyDefinitions();

  return prisma.capacityPolicyDefinition.findMany({
    include: {
      tiers: {
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { resourceType: "asc" }
  });
}

export async function updateCapacityPolicyDefinition(
  resourceType: CapacityResourceType,
  input: {
    enforcementEnabled?: boolean;
    tiers?: CapacityPolicyTierInput[];
  }
) {
  await ensureCapacityPolicyDefinitions();

  const definition = await prisma.capacityPolicyDefinition.findUniqueOrThrow({
    where: { resourceType }
  });

  if (input.enforcementEnabled !== undefined) {
    await prisma.capacityPolicyDefinition.update({
      where: { id: definition.id },
      data: { enforcementEnabled: input.enforcementEnabled }
    });
  }

  if (input.tiers) {
    await prisma.$transaction(async (tx) => {
      await tx.capacityPolicyTier.deleteMany({
        where: { definitionId: definition.id }
      });

      await tx.capacityPolicyTier.createMany({
        data: input.tiers!.map((tier) => ({
          definitionId: definition.id,
          tierKey: tier.tierKey,
          name: tier.name,
          description: tier.description ?? null,
          sortOrder: tier.sortOrder,
          maxCapacity: tier.maxCapacity ?? null,
          minEffectiveCredit: tier.minEffectiveCredit,
          enabled: tier.enabled ?? true
        }))
      });
    });
  }

  await recordAuditEvent({
    action: "capacity_policy.updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "CapacityPolicyDefinition",
    entityId: definition.id,
    payload: {
      resourceType,
      enforcementEnabled: input.enforcementEnabled,
      tierCount: input.tiers?.length
    }
  });

  return prisma.capacityPolicyDefinition.findUniqueOrThrow({
    where: { resourceType },
    include: { tiers: { orderBy: { sortOrder: "asc" } } }
  });
}

export async function upsertAppCapacityOverride(
  appId: string,
  resourceType: CapacityResourceType,
  input: AppCapacityOverrideInput
) {
  const override = await prisma.appCapacityPolicyOverride.upsert({
    where: {
      appId_resourceType: {
        appId,
        resourceType
      }
    },
    update: {
      enforcementDisabled: input.enforcementDisabled,
      maxCapacityOverride: input.maxCapacityOverride ?? null,
      minEffectiveCreditOverride:
        input.minEffectiveCreditOverride === undefined
          ? undefined
          : input.minEffectiveCreditOverride,
      unlimitedCapacityGranted: input.unlimitedCapacityGranted,
      notes: input.notes ?? null
    },
    create: {
      appId,
      resourceType,
      enforcementDisabled: input.enforcementDisabled ?? false,
      maxCapacityOverride: input.maxCapacityOverride ?? null,
      minEffectiveCreditOverride: input.minEffectiveCreditOverride ?? null,
      unlimitedCapacityGranted: input.unlimitedCapacityGranted ?? false,
      notes: input.notes ?? null
    }
  });

  await recordAuditEvent({
    action: "capacity_policy.app_override_updated",
    actorType: "INTERNAL_SERVICE",
    entityType: "App",
    entityId: appId,
    payload: {
      resourceType,
      override
    }
  });

  return override;
}

export async function evaluateCapacityEligibility(input: {
  appId: string;
  resourceType: CapacityResourceType;
  excludeProfileId?: string;
  prospectiveNewRecipient?: boolean;
}): Promise<CapacityEligibilitySnapshot> {
  await ensureCapacityPolicyDefinitions();

  const [app, definition, override, balance] = await Promise.all([
    prisma.app.findUniqueOrThrow({
      where: { id: input.appId },
      select: {
        id: true,
        status: true,
        destinationProfileProvisioningEnabled: true,
        destinationProfileLimit: true
      }
    }),
    prisma.capacityPolicyDefinition.findUniqueOrThrow({
      where: { resourceType: input.resourceType },
      include: {
        tiers: {
          where: { enabled: true },
          orderBy: { sortOrder: "asc" }
        }
      }
    }),
    prisma.appCapacityPolicyOverride.findUnique({
      where: {
        appId_resourceType: {
          appId: input.appId,
          resourceType: input.resourceType
        }
      }
    }),
    getCreditBalance(input.appId)
  ]);

  const enforcementEnabled = definition.enforcementEnabled && !override?.enforcementDisabled;
  const administrativeLimit = resolveAdministrativeLimit(app, override, input.resourceType);
  const currentUsage = await countResourceUsage(input.appId, input.resourceType, input.excludeProfileId);
  const effectiveBalance = balance.effectiveBalance;

  const baseReasons: CapacityEligibilitySnapshot["reasons"] = [];

  if (app.status !== "ACTIVE") {
    baseReasons.push({
      code: "APPLICATION_SUSPENDED",
      message: "This application is not active."
    });
  }

  if (input.resourceType === "RECIPIENT" && !app.destinationProfileProvisioningEnabled) {
    baseReasons.push({
      code: "PROVISIONING_DISABLED",
      message: "Recipient provisioning is not enabled for this application."
    });
  }

  let activeTier = null as CapacityEligibilitySnapshot["activeTier"];
  let nextTier = null as CapacityEligibilitySnapshot["nextTier"];
  let minCreditRequired = 0;
  let tierMaxCapacity: number | null = null;

  if (enforcementEnabled) {
    minCreditRequired =
      override?.minEffectiveCreditOverride !== undefined && override.minEffectiveCreditOverride !== null
        ? Number(override.minEffectiveCreditOverride)
        : 0;

    const qualifyingTiers = definition.tiers.filter(
      (tier) => effectiveBalance >= Number(tier.minEffectiveCredit)
    );
    const selectedTier = qualifyingTiers.at(-1) ?? null;
    const upcomingTier =
      definition.tiers.find((tier) => effectiveBalance < Number(tier.minEffectiveCredit)) ?? null;

    if (selectedTier) {
      activeTier = serializeTier(selectedTier);
      minCreditRequired = Math.max(minCreditRequired, Number(selectedTier.minEffectiveCredit));
      tierMaxCapacity = selectedTier.maxCapacity;
    } else if (override?.minEffectiveCreditOverride === undefined || override.minEffectiveCreditOverride === null) {
      baseReasons.push({
        code: "INSUFFICIENT_CREDIT",
        message: `Insufficient FlowPay credit. Top up to at least ${upcomingTier ? Number(upcomingTier.minEffectiveCredit) : 10} units to activate recipients.`
      });
      if (upcomingTier) {
        nextTier = serializeTier(upcomingTier);
        minCreditRequired = Number(upcomingTier.minEffectiveCredit);
      }
    }

    if (upcomingTier && selectedTier) {
      nextTier = serializeTier(upcomingTier);
    }

    if (
      override?.minEffectiveCreditOverride !== undefined &&
      override.minEffectiveCreditOverride !== null &&
      effectiveBalance < Number(override.minEffectiveCreditOverride)
    ) {
      baseReasons.push({
        code: "INSUFFICIENT_CREDIT",
        message: `Insufficient FlowPay credit. This application requires at least ${Number(override.minEffectiveCreditOverride)} units.`
      });
    }
  }

  const effectiveMaxCapacity = resolveEffectiveMaxCapacity({
    resourceType: input.resourceType,
    enforcementEnabled,
    administrativeLimit,
    tierMaxCapacity,
    override
  });

  const appendCapacityReasons = (projectedUsage: number) => {
    const combined = [...baseReasons];

    if (administrativeLimit <= 0 && input.resourceType === "RECIPIENT") {
      combined.push({
        code: "ADMIN_LIMIT_EXCEEDED",
        message: "Recipient profile limit is not configured for this application."
      });
    }

    if (effectiveMaxCapacity !== null && projectedUsage > effectiveMaxCapacity) {
      combined.push({
        code: "CAPACITY_EXCEEDED",
        message:
          effectiveMaxCapacity === 1
            ? "Recipient capacity reached. Upgrade credit or request a higher limit to add more recipients."
            : `Recipient capacity reached (${projectedUsage}/${effectiveMaxCapacity}). Upgrade credit or request a higher limit.`
      });
    }

    if (administrativeLimit > 0 && projectedUsage > administrativeLimit) {
      combined.push({
        code: "ADMIN_LIMIT_EXCEEDED",
        message: `Administrative recipient limit reached (${administrativeLimit}).`
      });
    }

    return combined;
  };

  const activationReasons = appendCapacityReasons(currentUsage);
  const createReasons = appendCapacityReasons(currentUsage + 1);
  const reasons = input.prospectiveNewRecipient ? createReasons : activationReasons;
  const eligible = reasons.length === 0;
  const remainingCapacity =
    effectiveMaxCapacity === null ? null : Math.max(effectiveMaxCapacity - currentUsage, 0);

  return {
    resourceType: input.resourceType,
    eligible,
    enforcementEnabled,
    effectiveBalance,
    minCreditRequired,
    currentUsage,
    effectiveMaxCapacity,
    remainingCapacity,
    administrativeLimit,
    activeTier,
    nextTier,
    reasons,
    canActivateRecipient: activationReasons.length === 0,
    canCreateRecipient: createReasons.length === 0
  };
}

export async function assertRecipientCapacityEligible(input: {
  appId: string;
  excludeProfileId?: string;
  forActivation?: boolean;
}) {
  const snapshot = await evaluateCapacityEligibility({
    appId: input.appId,
    resourceType: "RECIPIENT",
    excludeProfileId: input.excludeProfileId,
    prospectiveNewRecipient: false
  });

  const allowed = input.forActivation ? snapshot.canActivateRecipient : snapshot.canCreateRecipient;

  if (!allowed) {
    const message = snapshot.reasons[0]?.message ?? "Recipient capacity requirements are not met.";
    throw new CapacityEligibilityError(message, 409, snapshot);
  }

  return snapshot;
}

function resolveAdministrativeLimit(
  app: {
    destinationProfileLimit: number;
  },
  override: {
    maxCapacityOverride: number | null;
    unlimitedCapacityGranted: boolean;
  } | null,
  resourceType: CapacityResourceType
) {
  if (resourceType !== "RECIPIENT") {
    return override?.maxCapacityOverride ?? Number.MAX_SAFE_INTEGER;
  }

  if (override?.unlimitedCapacityGranted) {
    return override.maxCapacityOverride ?? Number.MAX_SAFE_INTEGER;
  }

  if (override?.maxCapacityOverride !== undefined && override.maxCapacityOverride !== null) {
    return override.maxCapacityOverride;
  }

  return app.destinationProfileLimit;
}

function resolveEffectiveMaxCapacity(input: {
  resourceType: CapacityResourceType;
  enforcementEnabled: boolean;
  administrativeLimit: number;
  tierMaxCapacity: number | null;
  override: {
    maxCapacityOverride: number | null;
    unlimitedCapacityGranted: boolean;
  } | null;
}) {
  if (input.resourceType !== "RECIPIENT") {
    return input.override?.maxCapacityOverride ?? input.tierMaxCapacity;
  }

  if (input.override?.unlimitedCapacityGranted) {
    return input.administrativeLimit >= Number.MAX_SAFE_INTEGER / 2
      ? null
      : input.administrativeLimit;
  }

  if (!input.enforcementEnabled) {
    return input.administrativeLimit > 0 ? input.administrativeLimit : null;
  }

  const caps: number[] = [];

  if (input.administrativeLimit > 0 && input.administrativeLimit < Number.MAX_SAFE_INTEGER / 2) {
    caps.push(input.administrativeLimit);
  }

  if (input.tierMaxCapacity !== null && input.tierMaxCapacity !== undefined) {
    caps.push(input.tierMaxCapacity);
  }

  if (input.override?.maxCapacityOverride !== undefined && input.override.maxCapacityOverride !== null) {
    caps.push(input.override.maxCapacityOverride);
  }

  if (caps.length === 0) {
    return input.tierMaxCapacity;
  }

  return Math.min(...caps);
}

async function countResourceUsage(
  appId: string,
  resourceType: CapacityResourceType,
  excludeProfileId?: string
) {
  if (resourceType === "RECIPIENT") {
    return prisma.destinationProfile.count({
      where: {
        appId,
        deletedAt: null,
        verificationStatus: { in: ["VERIFIED", "PENDING"] },
        ...(excludeProfileId ? { id: { not: excludeProfileId } } : {})
      }
    });
  }

  return 0;
}

function serializeTier(tier: {
  tierKey: string;
  name: string;
  description: string | null;
  maxCapacity: number | null;
  minEffectiveCredit: { toString(): string };
}) {
  return {
    tierKey: tier.tierKey,
    name: tier.name,
    description: tier.description,
    maxCapacity: tier.maxCapacity,
    minEffectiveCredit: Number(tier.minEffectiveCredit)
  };
}

export function serializeCapacityEligibilityForConsumer(snapshot: CapacityEligibilitySnapshot) {
  return {
    eligible: snapshot.eligible,
    effectiveBalance: snapshot.effectiveBalance,
    minCreditRequired: snapshot.minCreditRequired,
    currentUsage: snapshot.currentUsage,
    effectiveMaxCapacity: snapshot.effectiveMaxCapacity,
    remainingCapacity: snapshot.remainingCapacity,
    activeTier: snapshot.activeTier,
    nextTier: snapshot.nextTier,
    canActivate: snapshot.canActivateRecipient,
    canCreate: snapshot.canCreateRecipient,
    reasons: snapshot.reasons.map((reason) => reason.message)
  };
}
