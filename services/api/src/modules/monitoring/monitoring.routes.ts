import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/db.js";
import { verifyInternalService } from "../auth/internal-auth.guard.js";
import { listAuditLogs } from "../audit/audit.service.js";
import { retryQueue, webhookQueue } from "../../lib/queues.js";
import { listPayoutCoordinations, processPayoutCoordination } from "../payouts/payout-coordination.service.js";
import { isRedisCircuitOpen, isRedisQuotaError, openRedisCircuit } from "../../config/redis.js";

export async function registerMonitoringRoutes(app: FastifyInstance) {
  app.get("/internal/monitoring/gateways", { preHandler: [verifyInternalService] }, async () =>
    prisma.gatewayHealth.findMany({ orderBy: { provider: "asc" } })
  );

  app.get("/internal/monitoring/webhooks", { preHandler: [verifyInternalService] }, async () =>
    prisma.webhookLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  );

  app.get("/internal/monitoring/retries", { preHandler: [verifyInternalService] }, async () =>
    prisma.retryJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  );

  app.get("/internal/monitoring/performance", { preHandler: [verifyInternalService] }, async () =>
    prisma.transactionEvent.findMany({
      where: {
        eventType: {
          startsWith: "performance."
        }
      },
      include: {
        transaction: {
          select: {
            id: true,
            externalReference: true,
            status: true,
            selectedProvider: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  );

  app.get("/internal/monitoring/queues", { preHandler: [verifyInternalService] }, async () => ({
    retryQueue: retryQueue ? await getQueueCountsSafely(retryQueue) : null,
    webhookQueue: webhookQueue ? await getQueueCountsSafely(webhookQueue) : null
  }));

  app.get("/internal/monitoring/settlements", { preHandler: [verifyInternalService] }, async () =>
    prisma.settlement.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  );

  app.get("/internal/monitoring/payout-coordinations", { preHandler: [verifyInternalService] }, async () =>
    listPayoutCoordinations()
  );

  app.post(
    "/internal/monitoring/payout-coordinations/:id/process",
    { preHandler: [verifyInternalService] },
    async (request) => {
      const { id } = request.params as { id: string };
      return processPayoutCoordination(id);
    }
  );

  app.get("/internal/monitoring/metering-ledger", { preHandler: [verifyInternalService] }, async () =>
    prisma.orchestrationMeteringLedger.findMany({
      include: {
        app: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          }
        },
        transaction: {
          select: {
            id: true,
            externalReference: true,
            status: true,
            selectedProvider: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  );

  app.get("/internal/monitoring/audit-logs", { preHandler: [verifyInternalService] }, async () =>
    listAuditLogs()
  );
}

async function getQueueCountsSafely(queue: NonNullable<typeof retryQueue>) {
  if (isRedisCircuitOpen()) {
    return {
      degraded: true,
      message: "Redis circuit is open; queue status is temporarily unavailable"
    };
  }

  try {
    return await queue.getJobCounts("waiting", "active", "delayed", "failed");
  } catch (error) {
    if (isRedisQuotaError(error)) {
      openRedisCircuit("monitoring", error);
    }

    return {
      degraded: true,
      message: error instanceof Error ? error.message : "Queue status unavailable"
    };
  }
}
