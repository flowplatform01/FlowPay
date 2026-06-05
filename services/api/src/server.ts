import "./config/network.js";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { connectWithRetry } from "./config/db.js";

// Wait for database to be fully awake (handles Neon cold-start) before accepting traffic
await connectWithRetry();

const app = await buildApp();

await app.listen({
  port: env.PORT,
  host: "0.0.0.0"
});
