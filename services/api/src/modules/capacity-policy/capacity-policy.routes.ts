import type { FastifyInstance } from "fastify";
import { CapacityResourceType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { verifyAppSecretKey } from "../auth/app-auth.guard.js";
import {
  evaluateCapacityEligibility,
  listCapacityPolicyDefinitions,
  serializeCapacityEligibilityForConsumer,
  updateCapacityPolicyDefinition,
  upsertAppCapacityOverride
} from "./capacity-policy.service.js";

const tierSchema = z.object({
  tierKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  maxCapacity: z.number().int().positive().nullable().optional(),
  minEffectiveCredit: z.number().nonnegative(),
  enabled: z.boolean().optional()
});

const updatePolicySchema = z.object({
  enforcementEnabled: z.boolean().optional(),
  tiers: z.array(tierSchema).min(1).optional()
});

const overrideSchema = z.object({
  enforcementDisabled: z.boolean().optional(),
  maxCapacityOverride: z.number().int().nonnegative().nullable().optional(),
  minEffectiveCreditOverride: z.number().nonnegative().nullable().optional(),
  unlimitedCapacityGranted: z.boolean().optional(),
  notes: z.string().nullable().optional()
});

export async function registerCapacityPolicyRoutes(app: FastifyInstance) {
  app.get("/internal/capacity-policies", { preHandler: [verifyInternalService] }, async () =>
    listCapacityPolicyDefinitions()
  );

  app.put("/internal/capacity-policies/:resourceType", { preHandler: [verifyInternalService] }, async (request, reply) => {
    const { resourceType } = request.params as { resourceType: CapacityResourceType };

    if (!Object.values(CapacityResourceType).includes(resourceType)) {
      return reply.code(400).send({ message: "Unsupported capacity resource type" });
    }

    const parsed = updatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid capacity policy payload" });
    }

    const definition = await updateCapacityPolicyDefinition(resourceType, parsed.data);
    return reply.send(definition);
  });

  app.get(
    "/internal/apps/:appId/capacity-eligibility/:resourceType",
    { preHandler: [verifyInternalService] },
    async (request, reply) => {
      const { appId, resourceType } = request.params as {
        appId: string;
        resourceType: CapacityResourceType;
      };

      if (!Object.values(CapacityResourceType).includes(resourceType)) {
        return reply.code(400).send({ message: "Unsupported capacity resource type" });
      }

      const [eligibility, override] = await Promise.all([
        evaluateCapacityEligibility({ appId, resourceType }),
        prisma.appCapacityPolicyOverride.findUnique({
          where: {
            appId_resourceType: {
              appId,
              resourceType
            }
          }
        })
      ]);

      return reply.send({
        eligibility,
        override: override
          ? {
              enforcementDisabled: override.enforcementDisabled,
              maxCapacityOverride: override.maxCapacityOverride,
              minEffectiveCreditOverride:
                override.minEffectiveCreditOverride !== null
                  ? Number(override.minEffectiveCreditOverride)
                  : null,
              unlimitedCapacityGranted: override.unlimitedCapacityGranted,
              notes: override.notes
            }
          : null
      });
    }
  );

  app.put(
    "/internal/apps/:appId/capacity-overrides/:resourceType",
    { preHandler: [verifyInternalService] },
    async (request, reply) => {
      const { appId, resourceType } = request.params as {
        appId: string;
        resourceType: CapacityResourceType;
      };

      if (!Object.values(CapacityResourceType).includes(resourceType)) {
        return reply.code(400).send({ message: "Unsupported capacity resource type" });
      }

      const parsed = overrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid capacity override payload" });
      }

      const override = await upsertAppCapacityOverride(appId, resourceType, parsed.data);
      const eligibility = await evaluateCapacityEligibility({ appId, resourceType });
      return reply.send({ override, eligibility });
    }
  );

  app.get(
    "/capacity/recipients/eligibility",
    { preHandler: [verifyAppSecretKey] },
    async (request, reply) => {
      if (!request.appAuth) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const snapshot = await evaluateCapacityEligibility({
        appId: request.appAuth.appId,
        resourceType: "RECIPIENT"
      });

      return reply.send(serializeCapacityEligibilityForConsumer(snapshot));
    }
  );
}