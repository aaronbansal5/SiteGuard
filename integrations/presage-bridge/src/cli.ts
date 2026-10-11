import { existsSync } from "node:fs";
import { systemClock } from "./adapter.js";
import { PresageSdkAdapter } from "./adapters/presage-sdk.js";
import { DEFAULT_PORT, LOOPBACK_HOST } from "./contract.js";
import { PresageBridge } from "./server.js";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

/**
 * Production entry point. Always uses the real SmartSpectra 3.4.0 adapter,
 * which reports itself unavailable without an API key, a loadable SDK and a
 * camera. The fixture adapter is intentionally
 * not selectable here so fixture data can never reach the app labelled as a
 * real Presage measurement.
 */
const token = process.env.PRESAGE_BRIDGE_TOKEN ?? "";
const rawPort = process.env.PRESAGE_BRIDGE_PORT;
const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PRESAGE_BRIDGE_PORT must be an integer 1-65535");
  process.exit(2);
}
let bridge: PresageBridge;
try {
  bridge = new PresageBridge({
    token,
    port,
    adapter: new PresageSdkAdapter(systemClock),
    log: (l) => console.error(`[presage-bridge] ${l}`),
  });
} catch (e) {
  console.error(`[presage-bridge] ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
const bound = await bridge.listen();
const health = await bridge.health();
console.error(
  `[presage-bridge] listening on http://${LOOPBACK_HOST}:${bound} status=${health.status}` +
    (health.reason ? ` reason="${health.reason}"` : ""),
);
if (bound !== DEFAULT_PORT)
  console.error(
    `[presage-bridge] note: contract port is ${DEFAULT_PORT}; set the app's PRESAGE_BRIDGE_URL to match.`,
  );
const shutdown = async () => {
  console.error("[presage-bridge] stopping sessions and releasing camera");
  await bridge.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
