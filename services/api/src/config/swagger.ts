import type { FastifyInstance } from "fastify";

export async function registerSwagger(app: FastifyInstance) {
  await app.register(import("@fastify/swagger"), {
    openapi: {
      info: {
        title: "FlowPay API",
        version: "1.0.0"
      }
    }
  });

  await app.register(import("@fastify/swagger-ui"), {
    routePrefix: "/docs"
  });
}
