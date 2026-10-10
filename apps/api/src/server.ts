import { createApp } from "./app.js";
const { app, config } = await createApp({}, true);
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
