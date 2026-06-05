import type { FastifyInstance } from "fastify";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  DestinationProfileProvisioningError,
  listDestinationProfiles,
  provisionDestinationProfileForApp,
  updateDestinationProfile,
  upsertDestinationProfile
} from "./destination-profiles.service.js";
import {
  updateDestinationProfileSchema,
  upsertDestinationProfileSchema
} from "./destination-profiles.schema.js";
import { prisma } from "../../config/db.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";

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

      return reply.code(201).send({
        id: profile.id,
        externalRecipientId: profile.externalRecipientId,
        providerType: profile.providerType,
        settlementStrategy: profile.settlementStrategy,
        verificationStatus: profile.verificationStatus,
        regionalCurrency: profile.regionalCurrency,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        ...(profile.confirmationToken
          ? {
              confirmationUrl: (await import("./recipient-confirmation.service.js")).buildRecipientConfirmationUrl(
                profile.id,
                profile.confirmationToken
              )
            }
          : {})
      });
    } catch (error) {
      if (error instanceof DestinationProfileProvisioningError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });

  app.patch("/internal/destination-profiles/:id", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateDestinationProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid destination profile update payload" });
    }

    return updateDestinationProfile(id, parsed.data);
  });

  // ─── Recipient Confirmation (Governance) ──────────────────────────────────────

  app.get("/checkout/recipient/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    try {
      const { getRecipientConfirmationSession } = await import("./recipient-confirmation.service.js");
      const session = await getRecipientConfirmationSession(id, query.token);
      return reply.send({
        id: session.id,
        externalRecipientId: session.externalRecipientId,
        providerType: session.providerType,
        payoutTarget: session.payoutTarget,
        app: session.app,
        organization: session.organization
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Invalid confirmation session"
      });
    }
  });

  app.post("/checkout/recipient/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    try {
      const { approveRecipientConfirmation } = await import("./recipient-confirmation.service.js");
      await approveRecipientConfirmation(id, query.token);
      return reply.send({ success: true, status: "VERIFIED" });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Failed to approve confirmation"
      });
    }
  });

  app.post("/checkout/recipient/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string };

    if (!query.token) {
      return reply.code(400).send({ message: "Confirmation token is required" });
    }

    try {
      const { rejectRecipientConfirmation } = await import("./recipient-confirmation.service.js");
      await rejectRecipientConfirmation(id, query.token);
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
