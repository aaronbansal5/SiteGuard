import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
export interface Config {
  host: string;
  port: number;
  sqlitePath: string;
  databaseUrl?: string;
  cookieSecret: string;
  measurementToken: string;
  demoMode: boolean;
  hosted: boolean;
  bridgeUrl: string;
  bridgeToken?: string;
  geminiKey?: string;
  geminiModel?: string;
  webDist: string;
  mockIntervalMs: number;
  /**
   * Header set authoritatively by the reverse proxy with the client address
   * (Fly.io: fly-client-ip). Unset: rate limits use the socket address.
   */
  clientIpHeader?: string;
}
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const hosted = process.env.HOSTED === "true";
  const c: Config = {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3001),
    sqlitePath: resolve(process.env.SQLITE_PATH || ".data/siteguard.sqlite"),
    databaseUrl: process.env.DATABASE_URL || undefined,
    cookieSecret: process.env.COOKIE_SECRET || randomBytes(32).toString("hex"),
    measurementToken:
      process.env.MEASUREMENT_TOKEN || randomBytes(32).toString("hex"),
    demoMode: process.env.DEMO_MODE !== "false",
    hosted,
    bridgeUrl: process.env.PRESAGE_BRIDGE_URL || "http://127.0.0.1:4311",
    bridgeToken: process.env.PRESAGE_BRIDGE_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: process.env.GEMINI_MODEL?.trim() || undefined,
    webDist: resolve("apps/web/dist"),
    mockIntervalMs: 1000,
    clientIpHeader:
      process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined,
    ...overrides,
  };
  if (
    c.hosted &&
    (!(process.env.COOKIE_SECRET || overrides.cookieSecret) ||
      !(process.env.MEASUREMENT_TOKEN || overrides.measurementToken))
  )
    throw new Error("Hosted mode requires COOKIE_SECRET and MEASUREMENT_TOKEN");
  if (c.cookieSecret.length < 32)
    throw new Error("COOKIE_SECRET must have at least 32 characters");
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
    throw new Error("PORT must be valid");
  if (c.measurementToken.length < 16)
    throw new Error("MEASUREMENT_TOKEN must have at least 16 characters");
  if (
    c.clientIpHeader !== undefined &&
    (!/^[a-z0-9-]{1,64}$/.test(c.clientIpHeader) ||
      ["host", "cookie", "authorization"].includes(c.clientIpHeader))
  )
    throw new Error("CLIENT_IP_HEADER must be a single header name");
  if (!Number.isFinite(c.mockIntervalMs) || c.mockIntervalMs <= 0)
    throw new Error("Mock interval must be positive");
  const bridge = new URL(c.bridgeUrl);
  if (
    bridge.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(bridge.hostname) ||
    bridge.username ||
    bridge.password ||
    bridge.search ||
    bridge.hash ||
    bridge.pathname !== "/"
  )
    throw new Error(
      "PRESAGE_BRIDGE_URL must be an HTTP loopback origin without credentials",
    );
  return c;
}
