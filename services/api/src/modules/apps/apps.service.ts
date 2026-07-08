import { ApiKeyType, Prisma, type GatewayProvider } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { generateOpaqueKey, hashSecret } from "../../utils/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { GATEWAY_PROVIDERS } from "../providers/provider-registry.js";

const defaultCapabilities = ["PAYIN", "WEBHOOKS", "REFUNDS", "MANUAL_REVIEW"];
type ApiKeyTypeValue = ApiKeyType;

export async function createAppRegistration(input: {
  name: string;
  slug: string;
  organizationId: string;
  webhookUrl?: string;
  orchestrationCredits?: number;
  processingUnits?: number;
  infrastructureUsageBalance?: number;
  mode1MeteringEnabled?: boolean;
  mode2MeteringEnabled?: boolean;
  destinationProfileProvisioningEnabled?: boolean;
  destinationProfileAutoVerifyEnabled?: boolean;
  destinationProfileLimit?: number;
  recipientVerificationPaymentEnabled?: boolean;
  recipientVerificationAmountXaf?: number;
}) {
  const clientId = generateOpaqueKey("client");
  const clientSecret = generateOpaqueKey("client_secret");
  const publicKey = generateOpaqueKey("fpub");
  const secretKey = generateOpaqueKey("fsec");
  const webhookSecret = generateOpaqueKey("fwhsec");

  const app = await prisma.app.create({
    data: {
      name: input.name,
      slug: input.slug,
      organizationId: input.organizationId,
      clientId,
      clientSecretHash: hashSecret(clientSecret),
      appPublicKey: publicKey,
      webhookUrl: input.webhookUrl,
      orchestrationCredits: (input.orchestrationCredits ?? 0).toFixed(2),
      processingUnits: (input.processingUnits ?? 0).toFixed(2),
      infrastructureUsageBalance: (input.infrastructureUsageBalance ?? 0).toFixed(2),
      mode1MeteringEnabled: input.mode1MeteringEnabled ?? false,
      mode2MeteringEnabled: input.mode2MeteringEnabled ?? true,
      destinationProfileProvisioningEnabled: input.destinationProfileProvisioningEnabled ?? false,
      destinationProfileAutoVerifyEnabled: input.destinationProfileAutoVerifyEnabled ?? false,
      destinationProfileLimit: input.destinationProfileLimit ?? 0,
      recipientVerificationPaymentEnabled: input.recipientVerificationPaymentEnabled ?? false,
      recipientVerificationAmountXaf: (input.recipientVerificationAmountXaf ?? 100).toFixed(2),
      apiKeys: {
        create: [
          { label: "Public key", type: "PUBLIC", hashedKey: hashSecret(publicKey) },
          { label: "Secret key", type: "SECRET", hashedKey: hashSecret(secretKey) },
          { label: "Webhook secret", type: "WEBHOOK", hashedKey: hashSecret(webhookSecret) }
        ]
      },
      providerAccesses: {
        create: GATEWAY_PROVIDERS.map((provider, index) => ({
          provider,
          isEnabled: true,
          priority: (index + 1) * 100
        }))
      },
      capabilities: {
        create: defaultCapabilities.map((capability) => ({
          capability,
          isEnabled: true
        }))
      }
    },
    include: appInclude
  });

  await recordAuditEvent({
    action: "app.registered",
    entityType: "App",
    entityId: app.id,
    payload: {
      slug: app.slug,
      organizationId: app.organizationId,
      providers: GATEWAY_PROVIDERS,
      capabilities: defaultCapabilities
    }
  });

  return {
    app,
    credentials: {
      clientId,
      clientSecret,
      publicKey,
      secretKey,
      webhookSecret
    }
  };
}

export async function listApps() {
  await ensureDefaultAppControls();

  return prisma.app.findMany({
    include: appInclude,
    orderBy: { createdAt: "desc" }
  });
}

export async function updateAppConfiguration(
  appId: string,
  input: {
    status?: "ACTIVE" | "SUSPENDED";
    webhookUrl?: string | null;
    orchestrationCredits?: number;
    processingUnits?: number;
    infrastructureUsageBalance?: number;
    mode1MeteringEnabled?: boolean;
    mode2MeteringEnabled?: boolean;
    destinationProfileProvisioningEnabled?: boolean;
    destinationProfileAutoVerifyEnabled?: boolean;
    destinationProfileLimit?: number;
    recipientVerificationPaymentEnabled?: boolean;
    recipientVerificationAmountXaf?: number;
  }
) {
  const app = await prisma.app.update({
    where: { id: appId },
    data: {
      status: input.status,
      webhookUrl: input.webhookUrl === undefined ? undefined : input.webhookUrl || null,
      orchestrationCredits:
        input.orchestrationCredits === undefined ? undefined : input.orchestrationCredits.toFixed(2),
      processingUnits: input.processingUnits === undefined ? undefined : input.processingUnits.toFixed(2),
      infrastructureUsageBalance:
        input.infrastructureUsageBalance === undefined ? undefined : input.infrastructureUsageBalance.toFixed(2),
      mode1MeteringEnabled: input.mode1MeteringEnabled,
      mode2MeteringEnabled: input.mode2MeteringEnabled,
      destinationProfileProvisioningEnabled: input.destinationProfileProvisioningEnabled,
      destinationProfileAutoVerifyEnabled: input.destinationProfileAutoVerifyEnabled,
      destinationProfileLimit: input.destinationProfileLimit,
      recipientVerificationPaymentEnabled: input.recipientVerificationPaymentEnabled,
      recipientVerificationAmountXaf:
        input.recipientVerificationAmountXaf === undefined
          ? undefined
          : input.recipientVerificationAmountXaf.toFixed(2)
    },
    include: appInclude
  });

  await recordAuditEvent({
    action: "app.configuration_updated",
    entityType: "App",
    entityId: appId,
    payload: {
      status: input.status,
      webhookConfigured: input.webhookUrl !== undefined ? Boolean(input.webhookUrl) : undefined,
      meteringUpdated:
        input.orchestrationCredits !== undefined ||
        input.processingUnits !== undefined ||
        input.infrastructureUsageBalance !== undefined ||
        input.mode1MeteringEnabled !== undefined ||
        input.mode2MeteringEnabled !== undefined,
      destinationProvisioningUpdated:
        input.destinationProfileProvisioningEnabled !== undefined ||
        input.destinationProfileAutoVerifyEnabled !== undefined ||
        input.destinationProfileLimit !== undefined ||
        input.recipientVerificationPaymentEnabled !== undefined ||
        input.recipientVerificationAmountXaf !== undefined
    }
  });

  return app;
}

export async function topUpAppCredits(
  appId: string,
  input: {
    amount?: number;
    infrastructureUsageBalance?: number;
    processingUnits?: number;
    orchestrationCredits?: number;
    rechargeReference?: string;
    note?: string;
  }
) {
  const infrastructureTopup = input.infrastructureUsageBalance ?? input.amount ?? 0;
  const processingTopup = input.processingUnits ?? input.amount ?? 0;
  const orchestrationTopup = input.orchestrationCredits ?? input.amount ?? 0;

  if (infrastructureTopup <= 0 && processingTopup <= 0 && orchestrationTopup <= 0) {
    throw new Error("At least one positive credit top-up amount is required");
  }

  return prisma.$transaction(async (tx) => {
    const app = await tx.app.findUniqueOrThrow({
      where: { id: appId },
      select: {
        infrastructureUsageBalance: true,
        processingUnits: true,
        orchestrationCredits: true
      }
    });

    const before = {
      infrastructureUsageBalance: Number(app.infrastructureUsageBalance),
      processingUnits: Number(app.processingUnits),
      orchestrationCredits: Number(app.orchestrationCredits)
    };
    const after = {
      infrastructureUsageBalance: before.infrastructureUsageBalance + infrastructureTopup,
      processingUnits: before.processingUnits + processingTopup,
      orchestrationCredits: before.orchestrationCredits + orchestrationTopup
    };

    const updated = await tx.app.update({
      where: { id: appId },
      data: {
        infrastructureUsageBalance: after.infrastructureUsageBalance.toFixed(2),
        processingUnits: after.processingUnits.toFixed(2),
        orchestrationCredits: after.orchestrationCredits.toFixed(2)
      },
      include: appInclude
    });

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "app.credits_topped_up",
        entityType: "App",
        entityId: appId,
        payload: {
          before,
          topup: {
            infrastructureUsageBalance: infrastructureTopup,
            processingUnits: processingTopup,
            orchestrationCredits: orchestrationTopup
          },
          after,
          rechargeReference: input.rechargeReference,
          note: input.note
        } as Prisma.InputJsonValue
      }
    });

    return updated;
  });
}

export async function rotateAppCredentials(
  appId: string,
  input: {
    rotateClientSecret?: boolean;
    keyTypes?: ApiKeyTypeValue[];
  }
) {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: {
      apiKeys: true
    }
  });

  const keyTypes: ApiKeyTypeValue[] =
    input.keyTypes?.length ? input.keyTypes : [ApiKeyType.SECRET, ApiKeyType.WEBHOOK];
  const credentials: Record<string, string> = {};

  await prisma.$transaction(async (tx) => {
    if (input.rotateClientSecret) {
      const clientSecret = generateOpaqueKey("client_secret");
      await tx.app.update({
        where: { id: appId },
        data: {
          clientSecretHash: hashSecret(clientSecret)
        }
      });
      credentials.clientSecret = clientSecret;
    }

    for (const keyType of keyTypes) {
      await tx.apiKey.updateMany({
        where: {
          appId,
          type: keyType,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });

      const value =
        keyType === "PUBLIC"
          ? generateOpaqueKey("fpub")
          : keyType === "WEBHOOK"
            ? generateOpaqueKey("fwhsec")
            : generateOpaqueKey("fsec");

      await tx.apiKey.create({
        data: {
          appId,
          type: keyType,
          label:
            keyType === "PUBLIC"
              ? "Public key"
              : keyType === "WEBHOOK"
                ? "Webhook secret"
                : "Secret key",
          hashedKey: hashSecret(value)
        }
      });

      if (keyType === "PUBLIC") {
        await tx.app.update({
          where: { id: appId },
          data: {
            appPublicKey: value
          }
        });
      }

      credentials[keyType.toLowerCase()] = value;
    }

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "app.credentials_rotated",
        entityType: "App",
        entityId: appId,
        payload: {
          rotateClientSecret: Boolean(input.rotateClientSecret),
          keyTypes
        }
      }
    });
  });

  return {
    app: await prisma.app.findUniqueOrThrow({
      where: { id: app.id },
      include: appInclude
    }),
    credentials
  };
}

export async function updateAppAccess(
  appId: string,
  input: {
    providers?: Array<{
      provider: GatewayProvider;
      isEnabled: boolean;
      priority?: number;
    }>;
    capabilities?: Array<{
      capability: string;
      isEnabled: boolean;
    }>;
  }
) {
  await prisma.$transaction(async (tx) => {
    for (const provider of input.providers ?? []) {
      await tx.appProviderAccess.upsert({
        where: {
          appId_provider: {
            appId,
            provider: provider.provider
          }
        },
        update: {
          isEnabled: provider.isEnabled,
          priority: provider.priority ?? 100
        },
        create: {
          appId,
          provider: provider.provider,
          isEnabled: provider.isEnabled,
          priority: provider.priority ?? 100
        }
      });
    }

    for (const capability of input.capabilities ?? []) {
      await tx.appCapabilityGrant.upsert({
        where: {
          appId_capability: {
            appId,
            capability: capability.capability
          }
        },
        update: {
          isEnabled: capability.isEnabled
        },
        create: {
          appId,
          capability: capability.capability,
          isEnabled: capability.isEnabled
        }
      });
    }

    await tx.auditLog.create({
      data: {
        actorType: "INTERNAL_SERVICE",
        action: "app.access_policy_updated",
        entityType: "App",
        entityId: appId,
        payload: {
          providers: input.providers,
          capabilities: input.capabilities
        }
      }
    });
  });

  return prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: appInclude
  });
}

const appInclude = {
  organization: true,
  apiKeys: {
    orderBy: { createdAt: "desc" as const }
  },
  providerAccesses: {
    orderBy: [{ priority: "asc" as const }, { provider: "asc" as const }]
  },
  capabilities: {
    orderBy: { capability: "asc" as const }
  }
};

async function ensureDefaultAppControls() {
  const apps = await prisma.app.findMany({
    include: {
      providerAccesses: true,
      capabilities: true
    }
  });

  const providerRows = apps.flatMap((app) => {
    const existingProviders = new Set(app.providerAccesses.map((provider) => provider.provider));

    return GATEWAY_PROVIDERS.flatMap((provider, index) =>
      existingProviders.has(provider)
        ? []
        : [
            {
              appId: app.id,
              provider,
              isEnabled: true,
              priority: (index + 1) * 100
            }
          ]
    );
  });
  const capabilityRows = apps.flatMap((app) => {
    const existingCapabilities = new Set(app.capabilities.map((capability) => capability.capability));

    return defaultCapabilities.flatMap((capability) =>
      existingCapabilities.has(capability)
        ? []
        : [
            {
              appId: app.id,
              capability,
              isEnabled: true
            }
          ]
    );
  });

  await Promise.all([
    providerRows.length
      ? prisma.appProviderAccess.createMany({
          data: providerRows,
          skipDuplicates: true
        })
      : Promise.resolve(),
    capabilityRows.length
      ? prisma.appCapabilityGrant.createMany({
          data: capabilityRows,
          skipDuplicates: true
        })
      : Promise.resolve()
  ]);
}
