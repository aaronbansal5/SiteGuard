import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { login } from "./helpers.js";
import { fixtureId } from "@siteguard/mock-data";

it.each([false, true])(
  "local check-in bypass requires explicit test mode: %s",
  async (enabled) => {
    const h = await createApp({
      sqlitePath: ":memory:",
      databaseUrl: undefined,
      checkInTestMode: enabled,
      demoMode: true,
      hosted: false,
      authMode: "demo",
      cookieSecret: "test-secret-at-least-thirty-two-characters",
      measurementToken: "internal-test-token",
      webDist: "/nonexistent",
      geminiKey: undefined,
      geminiModel: undefined,
    });
    try {
      const br = (await h.repo.get("breaks", fixtureId(101)))!;
      br.startsAt = new Date(Date.now() - 120000).toISOString();
      br.endsAt = new Date(Date.now() - 60000).toISOString();
      await h.repo.put("breaks", br);
      const before = JSON.stringify(await h.repo.get("breaks", br.id));
      const cookie = await login(h.app);
      const res = await h.app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { cookie },
        payload: {
          breakId: br.id,
          source: "mock",
          consentVersion: "local-test",
          shareWithSupervisor: false,
          context: { workload: null, temperatureC: null },
        },
      });
      expect(res.statusCode).toBe(enabled ? 201 : 403);
      if (enabled) expect(res.json().session.consentVersion).toBe("local-test");
      expect(JSON.stringify(await h.repo.get("breaks", br.id))).toBe(before);
    } finally {
      await h.app.close();
    }
  },
);

it("local test mode can start without a scheduled break", async () => {
  const h = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    checkInTestMode: true,
    demoMode: true,
    hosted: false,
    authMode: "demo",
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    webDist: "/nonexistent",
    geminiKey: undefined,
    geminiModel: undefined,
  });
  try {
    const cookie = await login(h.app);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        source: "mock",
        consentVersion: "local-test",
        shareWithSupervisor: false,
        context: { workload: null, temperatureC: null },
      },
    });
    expect(res.statusCode).toBe(201);
    const session = res.json().session;
    expect(session.breakId).toEqual(expect.any(String));
    expect(session.consentVersion).toBe("local-test");
  } finally {
    await h.app.close();
  }
});
