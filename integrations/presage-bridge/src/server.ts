import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { once } from "node:events";
import { z } from "zod";
import sharp from "sharp";
import type { AdapterCapture, Clock, SdkAdapter } from "./adapter.js";
import { systemClock } from "./adapter.js";
import {
  DEFAULT_PORT,
  HEARTBEAT_MS,
  LOOPBACK_HOST,
  PROTOCOL_VERSION,
  REPLAY_WINDOW_MS,
  type BridgeEvent,
  type BridgeHealth,
} from "./contract.js";
import { EventLog, type LoggedEvent } from "./event-log.js";
import { normalizeSample, type ClockAnchor } from "./normalize.js";

export const MIN_TOKEN_LENGTH = 16;
const MAX_BODY_BYTES = 4096;
const MAX_RETAINED_STOPPED = 20;
const StartBody = z.strictObject({
  appSessionId: z.uuid(),
  input: z.enum(["camera", "custom"]).default("camera"),
});
const FRAME_WIDTH = 480;
const FRAME_HEIGHT = 360;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 4;
const MAX_JPEG_BYTES = 1024 * 1024;
const MAX_JPEG_DIMENSION = 960;

export interface BridgeOptions {
  token: string;
  adapter: SdkAdapter;
  clock?: Clock;
  /** Contract port is 4311; tests/smoke pass 0 for an ephemeral port. */
  port?: number;
  heartbeatMs?: number;
  replayWindowMs?: number;
  /** Release a capture when its application event stream disappears. */
  orphanGraceMs?: number;
  log?: (line: string) => void;
}

type SessionState = "starting" | "active" | "stopped";

class BridgeSession {
  readonly bridgeSessionId = randomUUID();
  state: SessionState = "starting";
  capture?: AdapterCapture;
  preview?: Buffer;
  previewAt = 0;
  anchor?: ClockAnchor;
  starting?: Promise<void>;
  stopping?: Promise<void>;
  frameWindowStartedAt = 0;
  frameWindowCount = 0;
  lastFrameTimestampUs = 0;
  frameQueue: Promise<void> = Promise.resolve();
  orphanTimer?: ReturnType<typeof setTimeout>;
  readonly log: EventLog;
  readonly streams = new Set<ServerResponse>();
  constructor(
    readonly appSessionId: string,
    readonly input: "camera" | "custom",
    windowMs: number,
    clock: Clock,
  ) {
    this.log = new EventLog(windowMs, () => clock.monotonicMs());
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function digest(s: string) {
  return createHash("sha256").update(s).digest();
}

function isLoopback(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export class PresageBridge {
  readonly server: Server;
  private readonly clock: Clock;
  private readonly heartbeatMs: number;
  private readonly windowMs: number;
  private readonly orphanGraceMs: number;
  private readonly tokenDigest: Buffer;
  private readonly sessions = new Map<string, BridgeSession>();
  /** The one session allowed to hold the camera (starting or active). */
  private cameraOwner?: BridgeSession;
  private readonly log: (line: string) => void;

  constructor(private options: BridgeOptions) {
    if (!options.token || options.token.length < MIN_TOKEN_LENGTH)
      throw new Error(
        `PRESAGE_BRIDGE_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters`,
      );
    this.tokenDigest = digest(options.token);
    this.clock = options.clock ?? systemClock;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.windowMs = options.replayWindowMs ?? REPLAY_WINDOW_MS;
    this.orphanGraceMs = options.orphanGraceMs ?? 10_000;
    this.log = options.log ?? (() => {});
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        const err =
          e instanceof HttpError
            ? e
            : new HttpError(500, "INTERNAL", "Bridge internal error");
        if (!(e instanceof HttpError)) this.log(`internal error: ${String(e)}`);
        if (!res.headersSent)
          this.json(res, err.status, {
            code: err.code,
            message: err.message,
          });
        else res.end();
      });
    });
  }

  /** Always binds 127.0.0.1. Resolves with the bound port. */
  async listen(): Promise<number> {
    this.server.listen(this.options.port ?? DEFAULT_PORT, LOOPBACK_HOST);
    await once(this.server, "listening");
    const a = this.server.address();
    if (!a || typeof a === "string") throw new Error("No bridge address");
    return a.port;
  }

  address() {
    return this.server.address();
  }

  /** Stop every session (releasing the camera) and close the server. */
  async close() {
    for (const s of this.sessions.values()) await this.stopSession(s);
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Drop all open SSE connections without stopping sessions (reconnect testing / ops). */
  disconnectStreams() {
    for (const s of this.sessions.values())
      for (const r of s.streams) r.destroy();
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  private authorized(req: IncomingMessage) {
    const h = req.headers.authorization;
    if (typeof h !== "string" || !h.startsWith("Bearer ")) return false;
    return timingSafeEqual(digest(h.slice(7)), this.tokenDigest);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!isLoopback(req.socket.remoteAddress))
      throw new HttpError(403, "FORBIDDEN", "Loopback clients only");
    // The backend calls the bridge, never a browser (contract). Browsers always
    // send Origin on cross-origin requests; refuse them outright.
    if (req.headers.origin !== undefined)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Browser requests are not accepted",
      );
    if (!this.authorized(req))
      throw new HttpError(
        401,
        "UNAUTHORIZED",
        "Missing or invalid bearer token",
      );
    const url = new URL(req.url ?? "/", "http://bridge.invalid");
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method ?? "GET";
    if (parts[0] !== "v1") throw new HttpError(404, "NOT_FOUND", "Not found");
    if (parts.length === 2 && parts[1] === "health") {
      if (method !== "GET")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "GET only");
      return this.json(
        res,
        200,
        await this.health(
          url.searchParams.get("input") === "custom" ? "custom" : "camera",
        ),
      );
    }
    if (parts.length === 3 && parts[1] === "previews" && method === "GET") {
      const session = [...this.sessions.values()].find(
        (s) => s.appSessionId === parts[2],
      );
      res.setHeader("Cache-Control", "no-store");
      if (
        !session ||
        session.state !== "active" ||
        !session.preview ||
        this.clock.monotonicMs() - session.previewAt > 2000
      ) {
        res.writeHead(204);
        return res.end();
      }
      res.setHeader("Content-Type", "image/jpeg");
      res.writeHead(200);
      return res.end(session.preview);
    }
    if (parts[1] !== "sessions")
      throw new HttpError(404, "NOT_FOUND", "Not found");
    if (parts.length === 2) {
      if (method !== "POST")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST only");
      return this.start(req, res);
    }
    const session = this.sessions.get(parts[2]);
    if (!session)
      throw new HttpError(404, "SESSION_NOT_FOUND", "Unknown bridge session");
    if (parts.length === 4 && parts[3] === "events") {
      if (method !== "GET")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "GET only");
      return this.events(session, url, req, res);
    }
    if (parts.length === 4 && parts[3] === "stop") {
      if (method !== "POST")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST only");
      await this.stopSession(session);
      return this.json(res, 200, { status: "stopped" });
    }
    if (parts.length === 4 && parts[3] === "frame") {
      if (method !== "POST")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST only");
      return this.frame(session, url, req, res);
    }
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }

  async health(input: "camera" | "custom" = "camera"): Promise<BridgeHealth> {
    let probe;
    try {
      probe = await this.options.adapter.probe(input);
    } catch (e) {
      probe = { ready: false, reason: `Adapter probe failed: ${String(e)}` };
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      source: "presage",
      status: probe.ready ? "ready" : "unavailable",
      reason: probe.reason,
    };
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES)
        throw new HttpError(413, "BODY_TOO_LARGE", "Request body too large");
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "INVALID_BODY", "Body must be JSON");
    }
  }

  private async start(req: IncomingMessage, res: ServerResponse) {
    const parsed = StartBody.safeParse(await this.readBody(req));
    if (!parsed.success)
      throw new HttpError(400, "INVALID_BODY", "Expected {appSessionId: UUID}");
    const { appSessionId, input } = parsed.data;
    const owner = this.cameraOwner;
    if (owner) {
      if (owner.appSessionId !== appSessionId)
        throw new HttpError(
          409,
          "CAMERA_BUSY",
          "Another session holds the camera",
        );
      if (owner.input !== input)
        throw new HttpError(
          409,
          "INPUT_MISMATCH",
          "Session input cannot change",
        );
      // Same appSessionId: return the existing session (idempotent start).
      await owner.starting;
      if (owner.state !== "active")
        throw new HttpError(
          503,
          "START_FAILED",
          "Camera session failed to start",
        );
      return this.json(res, 200, { bridgeSessionId: owner.bridgeSessionId });
    }
    for (const s of this.sessions.values())
      if (s.appSessionId === appSessionId && s.state === "stopped")
        throw new HttpError(
          409,
          "SESSION_ALREADY_STOPPED",
          "This app session was already stopped; begin a new check-in",
        );
    const probe = await this.options.adapter.probe(input);
    const health = {
      status: probe.ready ? "ready" : "unavailable",
      reason: probe.reason,
    };
    if (health.status !== "ready")
      throw new HttpError(
        503,
        "SDK_UNAVAILABLE",
        health.reason ?? "Bridge unavailable",
      );
    const session = new BridgeSession(
      appSessionId,
      input,
      this.windowMs,
      this.clock,
    );
    this.cameraOwner = session;
    session.starting = this.open(session);
    try {
      await session.starting;
    } catch (e) {
      if (this.cameraOwner === session) this.cameraOwner = undefined;
      this.log(`start failed: ${String(e)}`);
      throw new HttpError(
        503,
        "START_FAILED",
        e instanceof Error ? e.message : "Camera session failed to start",
      );
    }
    this.sessions.set(session.bridgeSessionId, session);
    this.retainBounded();
    this.json(res, 201, { bridgeSessionId: session.bridgeSessionId });
  }

  private async open(session: BridgeSession) {
    const anchor = {
      monotonicMs: this.clock.monotonicMs(),
      wallMs: this.clock.wallMs(),
    };
    session.anchor = anchor;
    const emit = (event: BridgeEvent) => {
      if (session.state === "stopped") return;
      session.log.append(event);
    };
    const capture = await this.options.adapter.open(
      {
        onPreview: (jpeg) => {
          if (session.state === "stopped" || jpeg.length > 1_000_000) return;
          session.preview = jpeg;
          session.previewAt = this.clock.monotonicMs();
        },
        onSample: (sample) => {
          if (
            !Number.isFinite(sample.monotonicMs) ||
            sample.monotonicMs < anchor.monotonicMs
          ) {
            emit({
              type: "error",
              code: "SAMPLE_TIME_INVALID",
              message:
                "A sample was dropped because its time preceded the session start.",
              retryable: true,
            });
            return;
          }
          for (const reading of normalizeSample(anchor, sample))
            emit({ type: "reading", reading });
        },
        onStatus: (state, message) => emit({ type: "status", state, message }),
        onError: (code, message, retryable) =>
          emit({ type: "error", code, message, retryable }),
      },
      session.input,
    );
    session.capture = capture;
    session.state = "active";
  }

  private async stopSession(session: BridgeSession) {
    if (session.state === "stopped") return;
    if (!session.stopping) {
      session.stopping = (async () => {
        clearTimeout(session.orphanTimer);
        session.orphanTimer = undefined;
        await session.starting?.catch(() => {});
        await session.capture?.close();
        session.log.append({ type: "status", state: "stopped", message: null });
        session.state = "stopped";
        session.preview = undefined;
        if (this.cameraOwner === session) this.cameraOwner = undefined;
        for (const r of session.streams) r.end();
      })();
      // If release fails the camera state is unknown: keep ownership so a retry
      // calls close() again rather than letting another session start.
      session.stopping.catch(() => {
        session.stopping = undefined;
      });
    }
    try {
      await session.stopping;
    } catch (e) {
      throw new HttpError(
        500,
        "STOP_FAILED",
        `Camera release failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * The API owns the only event stream for a live capture. If it goes away
   * (for example after a local API restart), the bridge must not keep the
   * camera locked forever. A grace period keeps normal SSE reconnects safe.
   */
  private scheduleOrphanStop(session: BridgeSession) {
    if (session.state === "stopped" || session.streams.size) return;
    clearTimeout(session.orphanTimer);
    session.orphanTimer = setTimeout(() => {
      session.orphanTimer = undefined;
      if (session.state !== "stopped" && !session.streams.size)
        void this.stopSession(session).catch((error) => {
          this.log(
            `orphaned camera release failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }, this.orphanGraceMs);
    session.orphanTimer.unref();
  }

  private async frame(
    session: BridgeSession,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    if (
      session.input !== "custom" ||
      session.state !== "active" ||
      !session.capture?.sendFrame
    )
      throw new HttpError(
        409,
        "INPUT_NOT_ACTIVE",
        "Custom input is not active",
      );
    const frameType = req.headers["content-type"];
    if (frameType !== "application/octet-stream" && frameType !== "image/jpeg")
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Camera frame required",
      );
    const timestampUs = Number(url.searchParams.get("timestampUs"));
    if (!Number.isSafeInteger(timestampUs) || timestampUs <= 0)
      throw new HttpError(400, "INVALID_TIMESTAMP", "Invalid frame timestamp");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > (frameType === "image/jpeg" ? MAX_JPEG_BYTES : FRAME_BYTES))
        throw new HttpError(413, "BODY_TOO_LARGE", "Frame too large");
      chunks.push(chunk as Buffer);
    }
    let frame: Buffer;
    let frameWidth = FRAME_WIDTH;
    let frameHeight = FRAME_HEIGHT;
    if (frameType === "image/jpeg") {
      if (size < 4)
        throw new HttpError(400, "INVALID_FRAME", "Invalid JPEG frame");
      try {
        const decoded = await sharp(Buffer.concat(chunks), {
          limitInputPixels: MAX_JPEG_DIMENSION * MAX_JPEG_DIMENSION,
          failOn: "error",
        })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (
          decoded.info.width < 240 ||
          decoded.info.height < 240 ||
          decoded.info.width > MAX_JPEG_DIMENSION ||
          decoded.info.height > MAX_JPEG_DIMENSION ||
          decoded.info.channels !== 4
        )
          throw new Error("Unexpected frame dimensions");
        frame = decoded.data;
        frameWidth = decoded.info.width;
        frameHeight = decoded.info.height;
      } catch {
        throw new HttpError(
          400,
          "INVALID_FRAME",
          "Expected a camera JPEG frame within 960x960 pixels",
        );
      }
    } else {
      if (size !== FRAME_BYTES)
        throw new HttpError(
          400,
          "INVALID_FRAME",
          "Expected 480x360 RGBA frame",
        );
      frame = Buffer.concat(chunks);
    }
    // Browser uploads can complete out of order when a frame is encoded while
    // another request is still in flight. SmartSpectra requires strictly
    // increasing timestamps, so stale frames are harmlessly discarded and
    // accepted frames are delivered one at a time.
    if (timestampUs <= session.lastFrameTimestampUs) {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    session.lastFrameTimestampUs = timestampUs;
    const capture = session.capture;
    session.frameQueue = session.frameQueue.then(() => {
      if (session.state !== "active")
        throw new Error("Presage session is no longer active");
      capture.sendFrame!(frame, frameWidth, frameHeight, timestampUs);
    });
    try {
      await session.frameQueue;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Presage rejected the camera frame";
      // A SmartSpectra invalid-state error is terminal for this SDK instance.
      // Release the camera and close the event stream so clients can start a
      // fresh check-in instead of continuing to post frames into a dead state.
      session.log.append({
        type: "error",
        code: "PRESAGE_FRAME_REJECTED",
        message:
          "Presage stopped accepting camera frames. Restart this check-in.",
        retryable: false,
      });
      await this.stopSession(session);
      throw new HttpError(503, "PRESAGE_FRAME_REJECTED", message);
    }
    const now = Date.now();
    if (session.frameWindowCount === 0) {
      session.frameWindowStartedAt = now;
      this.log(
        `camera frame geometry=${frameWidth}x${frameHeight} encodedBytes=${size}`,
      );
    }
    session.frameWindowCount++;
    const elapsed = now - session.frameWindowStartedAt;
    if (elapsed >= 5000) {
      this.log(
        `camera frame throughput=${(((session.frameWindowCount - 1) * 1000) / elapsed).toFixed(1)}fps over ${elapsed}ms`,
      );
      session.frameWindowStartedAt = now;
      session.frameWindowCount = 1;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
  }

  private retainBounded() {
    const stopped = [...this.sessions.values()].filter(
      (s) => s.state === "stopped",
    );
    for (const s of stopped.slice(
      0,
      Math.max(0, stopped.length - MAX_RETAINED_STOPPED),
    ))
      this.sessions.delete(s.bridgeSessionId);
  }

  private events(
    session: BridgeSession,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const raw = url.searchParams.get("after");
    const after = raw === null ? -1 : Number(raw);
    if (raw === "" || !Number.isSafeInteger(after) || after < -1)
      throw new HttpError(
        400,
        "INVALID_CURSOR",
        "after must be an integer >= -1",
      );
    const replay = session.log.replay(after);
    if (!replay.ok)
      throw new HttpError(
        409,
        "REPLAY_EXPIRED",
        "Requested events are older than the replay window; start a new session",
      );
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (e: LoggedEvent) =>
      res.write(`id: ${e.id}\ndata: ${JSON.stringify(e.event)}\n\n`);
    let cursor = after;
    for (const e of replay.events) {
      write(e);
      cursor = e.id;
    }
    if (session.state === "stopped") {
      res.end();
      return;
    }
    const unsubscribe = session.log.subscribe((e) => {
      if (e.id > cursor) {
        cursor = e.id;
        write(e);
      }
    });
    const heartbeat = setInterval(
      () => res.write(": heartbeat\n\n"),
      this.heartbeatMs,
    );
    clearTimeout(session.orphanTimer);
    session.orphanTimer = undefined;
    session.streams.add(res);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      session.streams.delete(res);
      this.scheduleOrphanStop(session);
    };
    res.on("close", cleanup);
    req.on("aborted", cleanup);
  }
}
