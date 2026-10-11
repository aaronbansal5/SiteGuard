import { createApp } from "../src/app.js";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import type { Session } from "@siteguard/contracts";
export async function testApp() {
  return createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    authMode: "demo",
    demoMode: true,
    hosted: false,
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    bridgeToken: undefined,
    webDist: "/nonexistent/siteguard-web",
    geminiKey: undefined,
    geminiModel: undefined,
  });
}
export async function login(
  app: Awaited<ReturnType<typeof testApp>>["app"],
  role: "worker" | "supervisor" = "worker",
  workerId = fixtureId(1),
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/demo/login",
    payload: role === "worker" ? { role, workerId } : { role },
  });
  return res.headers["set-cookie"]!.toString().split(";")[0];
}
export async function populatedSession(
  repo: Awaited<ReturnType<typeof testApp>>["repo"],
  share = false,
) {
  const startedAt = new Date(Date.now() - 61000).toISOString();
  const s: Session = {
    id: fixtureId(9000),
    workerId: fixtureId(1),
    breakId: fixtureId(101),
    source: "mock",
    status: "active",
    startedAt,
    endedAt: null,
    context: { workload: "heavy", temperatureC: 26 },
    consentVersion: "v1",
    shareWithSupervisor: share,
    interruption: null,
  };
  await repo.put("sessions", s);
  await repo.ingest(
    s.id,
    Array.from({ length: 60 }, (_, i) => mockReading(startedAt, i)),
  );
  return s;
}
