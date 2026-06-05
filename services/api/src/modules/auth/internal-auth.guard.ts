import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";

export async function verifyInternalService(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers["x-flowpay-internal-token"]?.toString();

  if (!token || token !== env.FLOWPAY_INTERNAL_TOKEN) {
    return reply.code(401).send({ message: "Invalid internal service token" });
  }
}
