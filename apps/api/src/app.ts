import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { loadConfig, type Config } from "./config.js";
import { openRepository } from "./db/repository.js";
import { seed } from "./db/seed.js";
import { interruptSessions } from "./domain/sessions.js";
import { MeasurementManager } from "./measurement/manager.js";
import { registerRoutes } from "./routes.js";
import { AppError } from "./errors.js";
export async function createApp(
  overrides: Partial<Config> = {},
  logger = false,
) {
  const c = loadConfig(overrides),
    app = Fastify({
      logger,
      bodyLimit: 1024 * 1024,
      forceCloseConnections: true,
    });
  await app.register(cookie, { secret: c.cookieSecret });
  const r = await openRepository(c);
  try {
    if (
      c.hosted &&
      (await r.list("sessions")).some((session) => session.source === "presage")
    )
      throw new Error(
        "Hosted demo refuses a database containing real measurement sessions",
      );
    if (c.demoMode) await seed(r);
    await interruptSessions(r);
  } catch (error) {
    await r.close();
    throw error;
  }
  const manager = new MeasurementManager(r, c);
  const writeRates = new Map<string, { count: number; resetsAt: number }>();
  app.addHook("onRequest", async (req, reply) => {
    if (["POST", "PATCH", "DELETE"].includes(req.method)) {
      const now = Date.now();
      // Bounded, process-local limits protect the demo. Multi-instance production
      // needs an upstream shared limiter and authenticated user quotas.
      if (writeRates.size >= 10000) {
        for (const [key, value] of writeRates)
          if (value.resetsAt <= now) writeRates.delete(key);
      }
      const login = req.url.split("?")[0] === "/api/demo/login";
      const key = `${req.ip}:${login ? "login" : "write"}`;
      const old = writeRates.get(key);
      const rate =
        old && old.resetsAt > now ? old : { count: 0, resetsAt: now + 60000 };
      rate.count++;
      if (writeRates.size < 10000 || writeRates.has(key))
        writeRates.set(key, rate);
      else failRate();
      if (rate.count > (login ? 30 : 120)) failRate();
      function failRate(): never {
        reply.header("Retry-After", "60");
        throw new AppError(
          429,
          "RATE_LIMITED",
          "Too many requests. Retry in one minute.",
        );
      }
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    if (c.hosted) {
      reply.header("Strict-Transport-Security", "max-age=31536000");
      reply.header(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
    }
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Cache-Control", "no-store");
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin
    ) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        reply.code(403);
        return {
          error: {
            code: "ORIGIN_REJECTED",
            message: "Invalid origin",
            requestId: req.id,
          },
        };
      }
      if (
        origin.host !== req.headers.host ||
        origin.protocol !== `${c.hosted ? "https" : req.protocol}:`
      ) {
        reply.code(403);
        return {
          error: {
            code: "ORIGIN_REJECTED",
            message: "Cross-origin writes are not allowed",
            requestId: req.id,
          },
        };
      }
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: "Check the submitted fields",
          fieldErrors: error.flatten().fieldErrors,
          requestId: req.id,
        },
      });
      return;
    }
    if (error instanceof AppError) {
      reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: req.id,
        },
      });
      return;
    }
    req.log.error({ err: error }, "Request failed");
    reply.code(503).send({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message:
          "A service is unavailable. Retry; the operation was not confirmed.",
        requestId: req.id,
      },
    });
  });
  await registerRoutes(app, r, c, manager);
  if (existsSync(c.webDist)) {
    await app.register(staticFiles, {
      root: c.webDist,
      prefix: "/",
      index: ["index.html"],
    });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split("?")[0];
      if (
        pathname === "/api" ||
        pathname.startsWith("/api/") ||
        pathname.startsWith("/assets/") ||
        /\.[^/]+$/.test(pathname) ||
        !["GET", "HEAD"].includes(req.method)
      )
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Endpoint not found",
            requestId: req.id,
          },
        });
      return reply.sendFile("index.html");
    });
  } else
    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Endpoint not found",
          requestId: req.id,
        },
      }),
    );
  app.addHook("onClose", async () => {
    try {
      await manager.close();
    } finally {
      await r.close();
    }
  });
  return { app, repo: r, manager, config: c };
}
