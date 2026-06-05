import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../config/db.js";
import { hashSecret } from "../../utils/crypto.js";

export async function verifyAppSecretKey(request: FastifyRequest, reply: FastifyReply) {
  const publicKey = request.headers["x-flowpay-public-key"]?.toString();
  const secretKey = request.headers["x-flowpay-secret-key"]?.toString();

  if (!publicKey || !secretKey) {
    return reply.code(401).send({ message: "Missing application credentials" });
  }

  const appRecord = await prisma.app.findUnique({
    where: { appPublicKey: publicKey },
    include: {
      organization: true,
      providerAccesses: true,
      capabilities: true,
      apiKeys: {
        where: {
          type: "SECRET",
          revokedAt: null
        },
        select: {
          type: true,
          hashedKey: true,
          revokedAt: true
        }
      }
    }
  });

  if (!appRecord) {
    return reply.code(401).send({ message: "Unknown app credentials" });
  }

  const hashedSecret = hashSecret(secretKey);
  const validSecret = appRecord.apiKeys.find((key) => key.hashedKey === hashedSecret);

  if (!validSecret) {
    return reply.code(401).send({ message: "Invalid secret key" });
  }

  const { apiKeys: _apiKeys, ...appProfile } = appRecord;

  request.appAuth = {
    appId: appRecord.id,
    organizationId: appRecord.organizationId,
    keyType: "SECRET",
    appProfile
  };
}
