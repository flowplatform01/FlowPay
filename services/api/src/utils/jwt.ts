import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAdminToken(adminId: string, role: string) {
  return jwt.sign({ sub: adminId, role }, env.JWT_SECRET, { expiresIn: "8h" });
}

export function verifyAdminToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as { sub: string; role: string };
}
