import { existsSync } from "node:fs";
import { createApp } from "./app.js";

if (existsSync(".env")) {
  const explicitEnvironment = new Map(Object.entries(process.env));
  process.loadEnvFile(".env");
  // Runtime/deployment environment variables must take precedence over the
  // local dotenv file, including when the server is started by a test runner.
  for (const [key, value] of explicitEnvironment) process.env[key] = value;
}

const { app, config } = await createApp({}, true);
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
