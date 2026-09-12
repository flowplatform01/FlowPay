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

export type ListAuditLogsFilter = {
  action?: string;
  actorType?: string;
  entityType?: string;
  entityId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  search?: string;
  page?: number;
  limit?: number;
};

export async function listAuditLogs(filters?: ListAuditLogsFilter) {
  if (!filters || Object.keys(filters).length === 0) {
    return prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  const where: Prisma.AuditLogWhereInput = {};

  if (filters.action && filters.action !== "ALL") {
    where.action = filters.action;
  }
  if (filters.actorType && filters.actorType !== "ALL") {
    where.actorType = filters.actorType;
  }
  if (filters.entityType && filters.entityType !== "ALL") {
    where.entityType = filters.entityType;
  }
  if (filters.entityId) {
    where.entityId = filters.entityId;
  }
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.createdAt.lte = new Date(filters.endDate);
    }
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      { entityId: { contains: q } },
      { actorId: { contains: q } }
    ];
  }

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit
    }),
    prisma.auditLog.count({ where })
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: skip + items.length < total
  };
}
