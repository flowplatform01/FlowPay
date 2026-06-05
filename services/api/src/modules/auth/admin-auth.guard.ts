import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminToken } from "../../utils/jwt.js";

export async function verifyAdmin(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ message: "Unauthorized" });
  }

  try {
    const payload = verifyAdminToken(header.slice(7));
    request.adminAuth = { adminId: payload.sub, role: payload.role };
  } catch {
    return reply.code(401).send({ message: "Invalid admin token" });
  }
}
