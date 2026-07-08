import type { GatewayProvider, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { GATEWAY_PROVIDERS } from "../providers/provider-registry.js";

type FeeRuleTypeValue = "FLAT" | "PERCENTAGE" | "HYBRID" | "DYNAMIC";

const organizationInclude = {
  apps: {
    include: {
      providerAccesses: {
        orderBy: [{ priority: "asc" as const }, { provider: "asc" as const }]
      },
      capabilities: {
        orderBy: { capability: "asc" as const }
      }
    },
    orderBy: { createdAt: "desc" as const }
  },
  payoutDestinations: {
    orderBy: [{ isDefault: "desc" as const }, { createdAt: "desc" as const }]
  },
  feeRules: {
    where: {
      isActive: true
    },
    include: {
      ranges: {
        orderBy: { sortOrder: "asc" as const }
      }
    },
    orderBy: { createdAt: "desc" as const }
  },
  providerAccesses: {
    orderBy: { provider: "asc" as const }
  }
};

export async function listOrganizations() {
  await ensureOrganizationProviderDefaults();

  return prisma.organization.findMany({
    include: organizationInclude,
    orderBy: { createdAt: "desc" }
  });
}

export async function createOrganization(input: {
  name: string;
  slug: string;
  countryCode: string;
  settlementCurrency: string;
}) {
  const organizationId = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        countryCode: input.countryCode.toUpperCase(),
        settlementCurrency: input.settlementCurrency.toUpperCase(),
        providerAccesses: {
          create: GATEWAY_PROVIDERS.map((provider) => ({
            provider,
            isEnabled: true
          }))
        }
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "organization.created",
        entityType: "Organization",
        entityId: organization.id,
        payload: {
          slug: organization.slug,
          countryCode: organization.countryCode,
          settlementCurrency: organization.settlementCurrency,
          defaultProviders: GATEWAY_PROVIDERS
        }
      }
    });

    return organization.id;
  });

  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: organizationInclude
  });
}

export async function updateOrganizationSettings(
  organizationId: string,
  input: {
    settlementCurrency?: string;
    enabledProviders?: Array<{
      provider: GatewayProvider;
      isEnabled: boolean;
    }>;
  }
) {
  await prisma.$transaction(async (tx) => {
    if (input.settlementCurrency) {
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          settlementCurrency: input.settlementCurrency
        }
      });
    }

    for (const provider of input.enabledProviders ?? []) {
      await tx.organizationProviderAccess.upsert({
        where: {
          organizationId_provider: {
            organizationId,
            provider: provider.provider
          }
        },
        update: {
          isEnabled: provider.isEnabled
        },
        create: {
          organizationId,
          provider: provider.provider,
          isEnabled: provider.isEnabled
        }
      });
    }

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "organization.settings_updated",
        entityType: "Organization",
        entityId: organizationId,
        payload: {
          settlementCurrency: input.settlementCurrency,
          enabledProviders: input.enabledProviders
        }
      }
    });
  });

  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: organizationInclude
  });
}

export async function upsertPayoutDestination(
  organizationId: string,
  input: {
    label: string;
    destinationType: string;
    destinationRef: string;
    currency: string;
    isDefault?: boolean;
  }
) {
  const destination = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.payoutDestination.updateMany({
        where: {
          organizationId,
          isDefault: true
        },
        data: {
          isDefault: false
        }
      });
    }

    const destination = await tx.payoutDestination.create({
      data: {
        organizationId,
        label: input.label,
        destinationType: input.destinationType,
        destinationRef: input.destinationRef,
        currency: input.currency,
        isDefault: input.isDefault ?? false
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "organization.payout_destination_created",
        entityType: "PayoutDestination",
        entityId: destination.id,
        payload: {
          organizationId,
          destinationType: input.destinationType,
          currency: input.currency,
          isDefault: input.isDefault ?? false
        }
      }
    });

    return destination;
  });

  return {
    destination,
    organization: await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: organizationInclude
    })
  };
}

export async function createFeeRule(
  organizationId: string,
  input: {
    name: string;
    type: FeeRuleTypeValue;
    flatAmount?: number;
    percentageRate?: number;
    dynamicConfig?: Record<string, unknown>;
    isActive?: boolean;
  }
) {
  const feeRule = await prisma.$transaction(async (tx) => {
    if (input.isActive ?? true) {
      await tx.feeRule.updateMany({
        where: {
          organizationId,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
    }

    const feeRule = await tx.feeRule.create({
      data: {
        organizationId,
        name: input.name,
        type: input.type,
        flatAmount: input.flatAmount?.toFixed(2),
        percentageRate: input.percentageRate?.toFixed(4),
        dynamicConfig: input.dynamicConfig as Prisma.InputJsonValue | undefined,
        isActive: input.isActive ?? true
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "fee_rule.created",
        entityType: "FeeRule",
        entityId: feeRule.id,
        payload: {
          organizationId,
          type: input.type,
          flatAmount: input.flatAmount,
          percentageRate: input.percentageRate,
          hasDynamicConfig: Boolean(input.dynamicConfig),
          isActive: input.isActive ?? true
        }
      }
    });

    return feeRule;
  });

  return {
    feeRule,
    organization: await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: organizationInclude
    })
  };
}

export async function updateFeeRule(
  feeRuleId: string,
  input: {
    name?: string;
    type?: FeeRuleTypeValue;
    flatAmount?: number;
    percentageRate?: number;
    dynamicConfig?: Record<string, unknown>;
    isActive?: boolean;
  }
) {
  const current = await prisma.feeRule.findUniqueOrThrow({
    where: { id: feeRuleId }
  });

  const feeRule = await prisma.$transaction(async (tx) => {
    if (input.isActive) {
      await tx.feeRule.updateMany({
        where: {
          organizationId: current.organizationId,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
    }

    const feeRule = await tx.feeRule.update({
      where: { id: feeRuleId },
      data: {
        name: input.name,
        type: input.type,
        flatAmount: input.flatAmount === undefined ? undefined : input.flatAmount.toFixed(2),
        percentageRate:
          input.percentageRate === undefined ? undefined : input.percentageRate.toFixed(4),
        dynamicConfig: input.dynamicConfig as Prisma.InputJsonValue | undefined,
        isActive: input.isActive
      }
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "fee_rule.updated",
        entityType: "FeeRule",
        entityId: feeRule.id,
        payload: {
          type: input.type,
          flatAmount: input.flatAmount,
          percentageRate: input.percentageRate,
          hasDynamicConfig: Boolean(input.dynamicConfig),
          isActive: input.isActive
        }
      }
    });

    return feeRule;
  });

  return {
    feeRule,
    organization: await prisma.organization.findUniqueOrThrow({
      where: { id: current.organizationId },
      include: organizationInclude
    })
  };
}

async function ensureOrganizationProviderDefaults() {
  const organizations = await prisma.organization.findMany({
    include: {
      providerAccesses: true
    }
  });

  const providerRows = organizations.flatMap((organization) => {
    const existingProviders = new Set(organization.providerAccesses.map((provider) => provider.provider));

    return GATEWAY_PROVIDERS.flatMap((provider) =>
      existingProviders.has(provider)
        ? []
        : [
            {
              organizationId: organization.id,
              provider,
              isEnabled: true
            }
          ]
    );
  });

  if (providerRows.length) {
    await prisma.organizationProviderAccess.createMany({
      data: providerRows,
      skipDuplicates: true
    });
  }
}
