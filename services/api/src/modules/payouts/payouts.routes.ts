import type { FastifyInstance } from "fastify";
import { GatewayProvider, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, prismaTransactionOptions } from "../../config/db.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";
import { processPayoutCoordination } from "./payout-coordination.service.js";

const createPayoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default("XAF"),
  reference: z.string().min(3).max(120),
  destinationProfileId: z.string().min(1).optional(),
  externalRecipientId: z.string().min(1).optional(),
  provider: z.nativeEnum(GatewayProvider).optional(),
  metadata: z.record(z.unknown()).optional()
});

export async function registerPayoutRoutes(app: FastifyInstance) {
  app.post("/payouts", { preHandler: [verifyAppSecretKey] }, async (request, reply) => {
    const parsed = createPayoutSchema.safeParse(request.body);

    if (!parsed.success || !request.appAuth?.appProfile) {
      return reply.code(400).send({ message: "Invalid payout payload" });
    }

    const idempotencyKey = request.headers["idempotency-key"]?.toString() ?? parsed.data.reference;

    try {
      const payout = await createAppPayout({
        appId: request.appAuth.appId,
        organizationId: request.appAuth.organizationId,
        appProfile: request.appAuth.appProfile,
        idempotencyKey,
        ...parsed.data
      });

      return reply.code(payout.created ? 201 : 200).send(payout.response);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Unable to create payout"
      });
    }
  });
}

async function createAppPayout(input: {
  appId: string;
  organizationId: string;
  appProfile: {
    status: string;
    providerAccesses: Array<{ provider: GatewayProvider; isEnabled: boolean }>;
    capabilities: Array<{ capability: string; isEnabled: boolean }>;
  };
  idempotencyKey: string;
  amount: number;
  currency: string;
  reference: string;
  destinationProfileId?: string;
  externalRecipientId?: string;
  provider?: GatewayProvider;
  metadata?: Record<string, unknown>;
}) {
  if (input.appProfile.status !== "ACTIVE") {
    throw new Error("Application is suspended and cannot initiate payouts");
  }

  if (hasDisabledPayoutCapability(input.appProfile)) {
    throw new Error("Application payout capability is disabled");
  }

  const existing = await prisma.transaction.findUnique({
    where: {
      appId_idempotencyKey: {
        appId: input.appId,
        idempotencyKey: input.idempotencyKey
      }
    },
    include: { payoutCoordinations: true }
  });

  if (existing) {
    return {
      created: false,
      response: serializePayoutResponse(existing)
    };
  }

  const destinationProfile = await prisma.destinationProfile.findFirst({
    where: buildDestinationProfileLookup(input)
  });

  if (!destinationProfile) {
    throw new Error("Destination profile was not found for this application");
  }

  if (destinationProfile.verificationStatus !== "VERIFIED") {
    throw new Error("Destination profile is not verified for payouts");
  }

  const currency = input.currency.toUpperCase();
  if (destinationProfile.regionalCurrency.toUpperCase() !== currency) {
    throw new Error("Destination profile currency does not match payout currency");
  }

  const provider = input.provider ?? destinationProfile.providerType;
  const appProviderAccess = input.appProfile.providerAccesses.find((access) => access.provider === provider);
  if (appProviderAccess && !appProviderAccess.isEnabled) {
    throw new Error(`Application access to ${provider} is disabled`);
  }

  const created = await prisma.$transaction(
    async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          appId: input.appId,
          organizationId: input.organizationId,
          destinationProfileId: destinationProfile.id,
          externalRecipientId: destinationProfile.externalRecipientId,
          orchestrationMode: "MULTI_TENANT",
          settlementStrategy: destinationProfile.settlementStrategy,
          externalReference: input.reference,
          idempotencyKey: input.idempotencyKey,
          currency,
          amount: new Prisma.Decimal(input.amount),
          grossAmount: new Prisma.Decimal(input.amount),
          gatewayFeeAmount: new Prisma.Decimal(0),
          platformFeeAmount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(input.amount),
          settlementAmount: new Prisma.Decimal(input.amount),
          status: "PROCESSING",
          selectedProvider: provider,
          metadata: {
            ...(input.metadata ?? {}),
            source: "app_payout",
            payoutTargetMasked: maskPayoutTarget(destinationProfile.payoutTarget)
          } as Prisma.InputJsonValue
        }
      });

      const coordination = await tx.payoutCoordination.create({
        data: {
          transactionId: transaction.id,
          destinationProfileId: destinationProfile.id,
          provider,
          status: "PENDING",
          idempotencyKey: `app-payout:${input.appId}:${input.idempotencyKey}`,
          requestPayload: {
            reference: input.reference,
            amount: input.amount,
            currency,
            externalRecipientId: destinationProfile.externalRecipientId,
            destinationProfileId: destinationProfile.id
          } as Prisma.InputJsonValue
        }
      });

      await tx.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: "app_payout.created",
          payload: {
            provider,
            destinationProfileId: destinationProfile.id,
            externalRecipientId: destinationProfile.externalRecipientId
          } as Prisma.InputJsonValue
        }
      });

      await tx.auditLog.create({
        data: {
          actorType: "APP",
          actorId: input.appId,
          action: "app_payout.created",
          entityType: "Transaction",
          entityId: transaction.id,
          payload: {
            reference: input.reference,
            amount: input.amount,
            currency,
            provider,
            destinationProfileId: destinationProfile.id
          } as Prisma.InputJsonValue
        }
      });

      return { transaction, coordinationId: coordination.id };
    },
    prismaTransactionOptions
  );

  processPayoutCoordination(created.coordinationId).catch(() => undefined);

  return {
    created: true,
    response: serializePayoutResponse({
      ...created.transaction,
      payoutCoordinations: [{ status: "PENDING" }]
    })
  };
}

function hasDisabledPayoutCapability(appProfile: { capabilities: Array<{ capability: string; isEnabled: boolean }> }) {
  const payoutCapability = appProfile.capabilities.find((capability) => capability.capability === "PAYOUT");
  return payoutCapability ? !payoutCapability.isEnabled : false;
}

function buildDestinationProfileLookup(input: {
  appId: string;
  destinationProfileId?: string;
  externalRecipientId?: string;
}) {
  const candidates: Array<{ id: string } | { externalRecipientId: string }> = [];

  if (input.destinationProfileId) {
    candidates.push({ id: input.destinationProfileId });
    candidates.push({ externalRecipientId: input.destinationProfileId });
  }

  if (input.externalRecipientId && input.externalRecipientId !== input.destinationProfileId) {
    candidates.push({ externalRecipientId: input.externalRecipientId });
  }

  if (candidates.length === 0) {
    throw new Error("destinationProfileId or externalRecipientId is required");
  }

  return {
    appId: input.appId,
    deletedAt: null,
    OR: candidates
  };
}

function serializePayoutResponse(transaction: {
  id: string;
  externalReference: string;
  status: string;
  selectedProvider: GatewayProvider;
  amount: unknown;
  currency: string;
  payoutCoordinations?: Array<{ status: string }>;
}) {
  const coordinationStatus = transaction.payoutCoordinations?.[0]?.status;
  return {
    id: transaction.id,
    reference: transaction.externalReference,
    flowpayReference: transaction.id,
    provider: transaction.selectedProvider,
    status: mapPayoutStatus(coordinationStatus ?? transaction.status),
    amount: Number(transaction.amount),
    currency: transaction.currency
  };
}

function mapPayoutStatus(status: string): "pending" | "queued" | "processing" | "failed" {
  if (status === "FAILED") return "failed";
  if (status === "PROCESSING") return "processing";
  return "pending";
}

function maskPayoutTarget(value: string) {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 3)}****${value.slice(-2)}`;
}
