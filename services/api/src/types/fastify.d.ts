import "fastify";
import type { App, AppCapability, AppProviderAccess, Organization } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    appAuth?: {
      appId: string;
      organizationId: string;
      keyType: "SECRET" | "PUBLIC";
      appProfile?: App & {
        organization: Organization;
        providerAccesses: AppProviderAccess[];
        capabilities: AppCapability[];
      };
    };
    adminAuth?: {
      adminId: string;
      role: string;
    };
  }
}
