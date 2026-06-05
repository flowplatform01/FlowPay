import crypto from "node:crypto";
import { env } from "../config/env.js";

export function hashSecret(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function signPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function generateOpaqueKey(prefix: string) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export function encryptPlaceholder(value: string) {
  return Buffer.from(`${env.APP_SECRET_ENCRYPTION_KEY}:${value}`).toString("base64");
}
