import type { FastifyInstance } from "fastify";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import {
  createOrganizationSchema,
  createFeeRuleSchema,
  updateFeeRuleSchema,
  updateOrganizationSettingsSchema,
  upsertPayoutDestinationSchema
} from "./organizations.schema.js";
import {
  createFeeRule,
  createOrganization,
  listOrganizations,
  updateFeeRule,
  updateOrganizationSettings,
  upsertPayoutDestination
} from "./organizations.service.js";

export async function registerOrganizationRoutes(app: FastifyInstance) {
  app.get("/internal/organizations", { preHandler: [verifyInternalService] }, async () => listOrganizations());

  app.post("/internal/organizations", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = createOrganizationSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid organization creation payload" });
    }

    return reply.code(201).send(await createOrganization(parsed.data));
  });

  app.put("/internal/organizations/:id/settings", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateOrganizationSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid organization settings payload" });
    }

    const { id } = request.params as { id: string };
    return reply.send(await updateOrganizationSettings(id, parsed.data));
  });

  app.post(
    "/internal/organizations/:id/payout-destinations",
    { preHandler: [verifyInternalService] },
    async (request, reply) => {
      const parsed = upsertPayoutDestinationSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid payout destination payload" });
      }

      const { id } = request.params as { id: string };
      return reply.code(201).send(await upsertPayoutDestination(id, parsed.data));
    }
  );

  app.post("/internal/organizations/:id/fee-rules", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = createFeeRuleSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid fee rule payload" });
    }

    const { id } = request.params as { id: string };
    return reply.code(201).send(await createFeeRule(id, parsed.data));
  });

  app.patch("/internal/fee-rules/:id", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const parsed = updateFeeRuleSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid fee rule update payload" });
    }

    const { id } = request.params as { id: string };
    return reply.send(await updateFeeRule(id, parsed.data));
  });
}
