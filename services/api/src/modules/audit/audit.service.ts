import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";

export async function recordAuditEvent(input: {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorType?: string;
  actorId?: string | null;
  payload?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      actorType: input.actorType ?? "INTERNAL_SERVICE",
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload
    }
  });
}

export async function listAuditLogs() {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
