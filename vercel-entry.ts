// Built into a bundled root server.js by vercel.json. Bundling keeps private
// npm workspace packages inside the deployed function while leaving Fastify
// and other third-party runtime dependencies external.
import { createApp } from "./apps/api/src/app.js";

const { app, config } = await createApp({}, true);

await app.listen({ host: config.host, port: config.port });
