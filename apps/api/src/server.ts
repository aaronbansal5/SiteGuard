import { existsSync } from "node:fs";
import { createApp } from "./app.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const { app, config } = await createApp({}, true);
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
