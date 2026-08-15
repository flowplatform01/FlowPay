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

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string) {
  const [version, ivBase64, tagBase64, encryptedBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretEncryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function encryptPlaceholder(value: string) {
  return encryptSecret(value);
}

function secretEncryptionKey() {
  const source = env.APP_SECRET_ENCRYPTION_KEY ?? env.ENCRYPTION_KEY ?? env.JWT_SECRET;
  return crypto.createHash("sha256").update(source).digest();
}
