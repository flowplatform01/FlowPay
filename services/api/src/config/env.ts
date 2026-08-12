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
  FLOWPAY_PUBLIC_URL: z.preprocess(
    (val) => (typeof val === "string" && val.trim() !== "" ? val : undefined),
    z.string().url().default("http://localhost:3010")
  ),
  FLOW_ADMIN_URL: z.preprocess(
    (val) => (typeof val === "string" && val.trim() !== "" ? val : undefined),
    z.string().url().default("http://localhost:5001")
  ),
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
  FAPSHI_BASE_URL: z.string().default("https://live.fapshi.com"),
  FAPSHI_LIVE_BASE_URL: z.string().optional(),
  FAPSHI_SANDBOX_BASE_URL: z.string().default("https://sandbox.fapshi.com"),
  FAPSHI_LIVE_API_KEY_USER: z.string().optional(),
  FAPSHI_LIVE_API_USER: z.string().optional(),
  FAPSHI_LIVE_APIUSER: z.string().optional(),
  FAPSHI_LIVE_API_KEY: z.string().optional(),
  FAPSHI_LIVE_APIKEY: z.string().optional(),
  FAPSHI_LIVE_WEBHOOK_SECRET: z.string().optional(),
  FAPSHI_API_KEY_USER: z.string().optional(),
  FAPSHI_API_USER: z.string().optional(),
  FAPSHI_APIUSER: z.string().optional(),
  FAPSHI_API_KEY: z.string().optional(),
  FAPSHI_APIKEY: z.string().optional(),
  FAPSHI_WEBHOOK_SECRET: z.string().optional(),
  FAPSHI_SANDBOX_API_KEY_USER: z.string().optional(),
  FAPSHI_SANDBOX_API_USER: z.string().optional(),
  FAPSHI_SANDBOX_APIUSER: z.string().optional(),
  FAPSHI_SANDBOX_API_KEY: z.string().optional(),
  FAPSHI_SANDBOX_APIKEY: z.string().optional(),
  FAPSHI_SANDBOX_WEBHOOK_SECRET: z.string().optional(),
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
  NODE_ENV: z.preprocess(
    (val) => (typeof val === "string" ? val.toLowerCase().trim() : val),
    z.enum(["development", "test", "production"]).default("development")
  )
});

const parsed = envSchema.parse(process.env);
const fapshiLiveBaseUrl = parsed.FAPSHI_LIVE_BASE_URL ?? parsed.FAPSHI_BASE_URL;
const fapshiLiveApiUser =
  parsed.FAPSHI_LIVE_API_USER ??
  parsed.FAPSHI_LIVE_APIUSER ??
  parsed.FAPSHI_LIVE_API_KEY_USER ??
  parsed.FAPSHI_API_USER ??
  parsed.FAPSHI_APIUSER ??
  parsed.FAPSHI_API_KEY_USER ??
  "";
const fapshiLiveApiKey =
  parsed.FAPSHI_LIVE_API_KEY ?? parsed.FAPSHI_LIVE_APIKEY ?? parsed.FAPSHI_API_KEY ?? parsed.FAPSHI_APIKEY ?? "";
const fapshiLiveWebhookSecret = parsed.FAPSHI_LIVE_WEBHOOK_SECRET ?? parsed.FAPSHI_WEBHOOK_SECRET;
const fapshiSandboxApiUser =
  parsed.FAPSHI_SANDBOX_API_USER ?? parsed.FAPSHI_SANDBOX_APIUSER ?? parsed.FAPSHI_SANDBOX_API_KEY_USER ?? "";
const fapshiSandboxApiKey = parsed.FAPSHI_SANDBOX_API_KEY ?? parsed.FAPSHI_SANDBOX_APIKEY ?? "";
const fapshiRuntimeMode = parsed.NODE_ENV === "production" ? "live" : "sandbox";
const fapshiRuntimeBaseUrl =
  fapshiRuntimeMode === "live" ? fapshiLiveBaseUrl : parsed.FAPSHI_SANDBOX_BASE_URL;
const fapshiRuntimeApiUser = fapshiRuntimeMode === "live" ? fapshiLiveApiUser : fapshiSandboxApiUser;
const fapshiRuntimeApiKey = fapshiRuntimeMode === "live" ? fapshiLiveApiKey : fapshiSandboxApiKey;
const fapshiRuntimeWebhookSecret =
  fapshiRuntimeMode === "live"
    ? fapshiLiveWebhookSecret
    : parsed.FAPSHI_SANDBOX_WEBHOOK_SECRET ?? parsed.FAPSHI_WEBHOOK_SECRET;

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
  CINETPAY_PUBLIC_KEY: parsed.CINETPAY_PUBLIC_KEY ?? parsed.CINETPAY_API_KEY ?? "",
  FAPSHI_LIVE_BASE_URL: fapshiLiveBaseUrl,
  FAPSHI_LIVE_API_USER: fapshiLiveApiUser,
  FAPSHI_LIVE_API_KEY: fapshiLiveApiKey,
  FAPSHI_LIVE_WEBHOOK_SECRET: fapshiLiveWebhookSecret ?? parsed.WEBHOOK_SIGNING_SECRET ?? parsed.JWT_SECRET,
  FAPSHI_API_USER: fapshiLiveApiUser,
  FAPSHI_API_KEY: fapshiLiveApiKey,
  FAPSHI_SANDBOX_API_USER: fapshiSandboxApiUser,
  FAPSHI_SANDBOX_API_KEY: fapshiSandboxApiKey,
  FAPSHI_HAS_LIVE_CREDENTIALS: Boolean(fapshiLiveApiUser && fapshiLiveApiKey),
  FAPSHI_HAS_SANDBOX_CREDENTIALS: Boolean(fapshiSandboxApiUser && fapshiSandboxApiKey),
  FAPSHI_RUNTIME_MODE: fapshiRuntimeMode,
  FAPSHI_RUNTIME_BASE_URL: fapshiRuntimeBaseUrl,
  FAPSHI_RUNTIME_API_USER: fapshiRuntimeApiUser,
  FAPSHI_RUNTIME_API_KEY: fapshiRuntimeApiKey,
  FAPSHI_WEBHOOK_SECRET: parsed.FAPSHI_WEBHOOK_SECRET ?? parsed.WEBHOOK_SIGNING_SECRET ?? parsed.JWT_SECRET,
  FAPSHI_RUNTIME_WEBHOOK_SECRET: fapshiRuntimeWebhookSecret ?? parsed.WEBHOOK_SIGNING_SECRET ?? parsed.JWT_SECRET
};
