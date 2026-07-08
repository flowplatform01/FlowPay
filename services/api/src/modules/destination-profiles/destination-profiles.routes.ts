import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  DestinationProfileProvisioningError,
  getDestinationProfileForApp,
  initiateRecipientVerificationPayment,
  listDestinationProfiles,
  provisionDestinationProfileForApp,
  updateDestinationProfile,
  upsertDestinationProfile
} from "./destination-profiles.service.js";
import {
  updateDestinationProfileSchema,
  upsertDestinationProfileSchema
} from "./destination-profiles.schema.js";
import {
  approveRecipientConfirmationSchema,
  rejectRecipientConfirmationSchema
} from "./recipient-confirmation.schema.js";
import { prisma } from "../../config/db.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";

const recipientVerificationPaymentSchema = z.object({
  paymentMethod: z.enum(["MTN_MOMO", "ORANGE_MONEY", "CARD_PAYMENT", "BANK_TRANSFER"]).optional(),
  customerName: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().min(6).optional()
});

const recipientConfirmationRateLimit = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: "1 minute"
    }
  }
};

export async function registerDestinationProfileRoutes(app: FastifyInstance) {
  app.get("/internal/destination-profiles", { preHandler: [verifyInternalService] }, async (request) => {
    const query = request.query as { appId?: string };
    return listDestinationProfiles(query.appId);
  });

  app.post("/internal/apps/:appId/destination-profiles", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    const parsed = upsertDestinationProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid destination profile payload" });
    }

    const organizationId = await resolveAppOrganizationId(appId);
    if (!organizationId) {
      return reply.code(404).send({ message: "Application not found" });
    }

    const profile = await upsertDestinationProfile({
      appId,
      organizationId,
      ...parsed.data
    });

    return reply.code(201).send(profile);
  });

  app.post("/destination-profiles", { preHandler: [verifyAppSecretKey] }, async (request, reply) => {
    const parsed = upsertDestinationProfileSchema.safeParse(request.body);

    if (!parsed.success || !request.appAuth) {
      return reply.code(400).send({ message: "Invalid destination profile payload" });
    }

    try {
      const profile = await provisionDestinationProfileForApp(request.appAuth.appId, parsed.data);
      const { buildRecipientConfirmationUrl } = await import("./recipient-confirmation.service.js");

      return reply.code(201).send({
        id: profile.id,
        externalRecipientId: profile.externalRecipientId,
        settlementStrategy: profile.settlementStrategy,
        verificationStatus: profile.verificationStatus,
        regionalCurrency: profile.regionalCurrency,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        ...(profile.confirmationToken
          ? {
              confirmationUrl: buildRecipientConfirmationUrl(profile.id, profile.confirmationToken),
              confirmationRequired: true
            }
          : {
              confirmationRequired: false
            })
      });
    } catch (error) {
      if (error instanceof DestinationProfileProvisioningError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }

      const { CapacityEligibilityError } = await import("../capacity-policy/capacity-policy.service.js");
      if (error instanceof CapacityEligibilityError) {
        return reply.code(error.statusCode).send({
          message: error.message,
          capacityEligibility: error.snapshot
            ? {
                reasons: error.snapshot.reasons.map((item) => item.message),
                effectiveBalance: error.snapshot.effectiveBalance,
                minCreditRequired: error.snapshot.minCreditRequired,
                currentUsage: error.snapshot.currentUsage,
                effectiveMaxCapacity: error.snapshot.effectiveMaxCapacity
              }
            : undefined
        });
      }

      throw error;
    }
  });

  app.get("/destination-profiles/:externalRecipientId", { preHandler: [verifyAppSecretKey] }, async (request, reply) => {
    if (!request.appAuth) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    const { externalRecipientId } = request.params as { externalRecipientId: string };

    try {
      const profile = await getDestinationProfileForApp(request.appAuth.appId, externalRecipientId);
      return reply.send({
        id: profile.id,
        externalRecipientId: profile.externalRecipientId,
        verificationStatus: profile.verificationStatus,
        regionalCurrency: profile.regionalCurrency,
        updatedAt: profile.updatedAt
      });
    } catch (error) {
      return reply.code(404).send({
        message: error instanceof Error ? error.message : "Destination profile not found"
      });
    }
  });

  app.post(
    "/destination-profiles/:externalRecipientId/verification-payment",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const { externalRecipientId } = request.params as { externalRecipientId: string };
      const parsed = recipientVerificationPaymentSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid recipient verification payment payload" });
      }

      try {
        const transaction = await initiateRecipientVerificationPayment({
          appId: request.appAuth.appId,
          externalRecipientId,
          ...parsed.data
        });

        return reply.code(201).send(transaction);
      } catch (error) {
        if (error instanceof DestinationProfileProvisioningError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        throw error;
      }
    }
  );

  app.patch("/internal/destination-profiles/:id", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateDestinationProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid destination profile update payload" });
    }

    return updateDestinationProfile(id, parsed.data);
  });

  // ─── Recipient Confirmation Gateway ───────────────────────────────────────────

  app.get("/checkout/recipient/:id", recipientConfirmationRateLimit, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    try {
      const { getRecipientConfirmationSession } = await import("./recipient-confirmation.service.js");
      const session = await getRecipientConfirmationSession(id, query.token);
      return reply.send(session);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Invalid confirmation session"
      });
    }
  });

  app.post("/checkout/recipient/:id/approve", recipientConfirmationRateLimit, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };
    const parsed = approveRecipientConfirmationSchema.safeParse(request.body ?? {});

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid confirmation payload" });
    }

    try {
      const { approveRecipientConfirmation } = await import("./recipient-confirmation.service.js");
      const profile = await approveRecipientConfirmation(id, query.token, parsed.data);
      return reply.send({
        success: true,
        status: "VERIFIED",
        externalRecipientId: profile.externalRecipientId,
        payoutTarget: profile.payoutTarget
      });
    } catch (error) {
      const { CapacityEligibilityError } = await import("../capacity-policy/capacity-policy.service.js");
      if (error instanceof CapacityEligibilityError) {
        return reply.code(error.statusCode).send({
          message: error.message,
          capacityEligibility: error.snapshot
            ? {
                reasons: error.snapshot.reasons.map((item) => item.message),
                canActivate: error.snapshot.canActivateRecipient
              }
            : undefined
        });
      }

      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Failed to approve confirmation"
      });
    }
  });

  app.post("/checkout/recipient/:id/reject", recipientConfirmationRateLimit, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };
    const parsed = rejectRecipientConfirmationSchema.safeParse(request.body ?? {});

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid rejection payload" });
    }

    try {
      const { rejectRecipientConfirmation } = await import("./recipient-confirmation.service.js");
      await rejectRecipientConfirmation(id, query.token, parsed.data);
      return reply.send({ success: true, status: "REJECTED" });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Failed to reject confirmation"
      });
    }
  });
}

async function resolveAppOrganizationId(appId: string) {
  const appRecord = await prisma.app.findUnique({
    where: { id: appId },
    select: { organizationId: true }
  });

  return appRecord?.organizationId ?? null;
}
