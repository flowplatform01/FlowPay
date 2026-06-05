import dotenv from "dotenv";
import { z } from "zod";
import type { GatewayProvider } from "@prisma/client";

dotenv.config({ path: ".env" });
dotenv.config({ path: "services/api/.env", override: true });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  APP_SECRET_ENCRYPTION_KEY: z.string().min(16).optional(),
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
  FLOWPAY_INTERNAL_TOKEN: z.string().min(16),
  FLOWPAY_PUBLIC_URL: z.string().url(),
  FLOW_ADMIN_URL: z.string().url(),
  FLOWPAY_WEBHOOK_BASE_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional()
  ),
  CAMPAY_BASE_URL: z.string().default("https://demo.campay.net"),
  CAMPAY_USERNAME: z.string().optional(),
  CAMPAY_PASSWORD: z.string().optional(),
  CAMPAY_PUBLIC_KEY: z.string().optional(),
  CAMPAY_SECRET_KEY: z.string().optional(),
  CAMPAY_API_KEY: z.string().optional(),
  CAMPAY_API_SECRET: z.string().optional(),
  CAMPAY_WEBHOOK_SECRET: z.string().optional(),
  CAMPAY_ACCESS_TOKEN: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().optional()
  ),
  CAMPAY_APP_ID: z.string().optional(),
  MAVIANCE_BASE_URL: z.string().default("https://api.maviance.com"),
  MAVIANCE_PUBLIC_KEY: z.string().optional(),
  MAVIANCE_SECRET_KEY: z.string().optional(),
  MAVIANCE_API_KEY: z.string().optional(),
  MAVIANCE_SECRET: z.string().optional(),
  CINETPAY_BASE_URL: z.string().default("https://api-checkout.cinetpay.com"),
  CINETPAY_PUBLIC_KEY: z.string().optional(),
  CINETPAY_SECRET_KEY: z.string().optional(),
  CINETPAY_API_KEY: z.string().optional(),
  CINETPAY_SECRET: z.string().optional(),
  CINETPAY_SITE_ID: z.string().optional(),
  GATEWAY_REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
  PORT: z.coerce.number().default(3011),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  APP_SECRET_ENCRYPTION_KEY:
    parsed.APP_SECRET_ENCRYPTION_KEY ?? parsed.ENCRYPTION_KEY ?? parsed.JWT_SECRET,
  WEBHOOK_SIGNING_SECRET: parsed.WEBHOOK_SIGNING_SECRET ?? parsed.JWT_SECRET,
  CAMPAY_USERNAME: parsed.CAMPAY_USERNAME ?? parsed.CAMPAY_PUBLIC_KEY ?? "",
  CAMPAY_PASSWORD: parsed.CAMPAY_PASSWORD ?? parsed.CAMPAY_API_SECRET ?? parsed.CAMPAY_SECRET_KEY ?? "",
  CAMPAY_SECRET_KEY: parsed.CAMPAY_SECRET_KEY ?? parsed.CAMPAY_API_SECRET ?? "",
  CAMPAY_PUBLIC_KEY: parsed.CAMPAY_PUBLIC_KEY ?? parsed.CAMPAY_API_KEY ?? "",
  gatewayWebhookUrl(provider: GatewayProvider) {
    const base = (parsed.FLOWPAY_WEBHOOK_BASE_URL ?? `http://127.0.0.1:${parsed.PORT}`).replace(/\/$/, "");
    return `${base}/api/v1/webhooks/${provider}`;
  },
  MAVIANCE_SECRET_KEY: parsed.MAVIANCE_SECRET_KEY ?? parsed.MAVIANCE_SECRET ?? "",
  MAVIANCE_PUBLIC_KEY: parsed.MAVIANCE_PUBLIC_KEY ?? parsed.MAVIANCE_API_KEY ?? "",
  CINETPAY_SECRET_KEY: parsed.CINETPAY_SECRET_KEY ?? parsed.CINETPAY_SECRET ?? "",
  CINETPAY_PUBLIC_KEY: parsed.CINETPAY_PUBLIC_KEY ?? parsed.CINETPAY_API_KEY ?? ""
};
