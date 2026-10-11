import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureId } from "@siteguard/mock-data";
import { createApp } from "../src/app.js";
import {
  bootstrapManager,
  createAccountSession,
  tokenDigest,
} from "../src/auth-service.js";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  discovery: vi.fn(async () => ({})),
}));
vi.mock("openid-client", () => ({
  discovery: mocks.discovery,
  randomPKCECodeVerifier: () => "verifier",
  calculatePKCECodeChallenge: async () => "challenge",
  randomState: () => "state",
  randomNonce: () => "nonce",
  buildAuthorizationUrl: () => new URL("https://identity.example.com/auth"),
  authorizationCodeGrant: mocks.grant,
}));
const running: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const x of running.splice(0)) await x.app.close();
  vi.clearAllMocks();
});
async function setup(extra: Parameters<typeof createApp>[0] = {}) {
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    authMode: "oidc",
    appOrigin: "http://127.0.0.1:3001",
    siteId: "site-test",
    oidcIssuer: "https://identity.example.com",
    oidcClientId: "client",
    webDist: "/nonexistent",
    ...extra,
  });
  running.push(x);
  return x;
}
async function manager(x: Awaited<ReturnType<typeof setup>>) {
  const id = await bootstrapManager(x.repo, {
    issuer: x.config.oidcIssuer!,
    subject: "manager-sub",
    email: "manager@example.com",
    siteId: x.config.siteId,
  });
  return {
    id,
    cookie: `siteguard_session=${await createAccountSession(x.repo, id)}`,
  };
}
const writes = {
  origin: "http://127.0.0.1:3001",
  "content-type": "application/json",
};
async function callback(
  x: Awaited<ReturnType<typeof setup>>,
  claims: Record<string, unknown>,
  invitation?: string,
) {
  mocks.grant.mockResolvedValue({ claims: () => claims });
  const start = await x.app.inject(
    `/api/auth/login${invitation ? `?invitation=${invitation}` : ""}`,
  );
  expect(start.statusCode).toBe(302);
  const cookie = String(start.headers["set-cookie"]).split(";")[0];
  return x.app.inject({
    url: "/api/auth/callback?code=example&state=state",
    headers: { cookie },
  });
}
describe("account authentication boundaries", () => {
  it("has anonymous config/me and forbids role selection even with demoMode true", async () => {
    const x = await setup();
    expect((await x.app.inject("/api/auth/me")).json().identity).toBeNull();
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/demo/login",
          headers: writes,
          payload: { role: "supervisor" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("logs in only bootstrapped matching verified account; logout revokes replay", async () => {
    const x = await setup();
    const m = await manager(x);
    expect(
      (
        await x.app.inject({
          url: "/api/auth/me",
          headers: { cookie: m.cookie },
        })
      ).json().identity.role,
    ).toBe("supervisor");
    const response = await callback(x, {
      iss: x.config.oidcIssuer,
      sub: "manager-sub",
      email: "manager@example.com",
      email_verified: true,
    });
    expect(response.statusCode).toBe(302);
    const cookie = String(response.headers["set-cookie"])
      .split(",")
      .find((c) => c.includes("siteguard_session="))!;
    const sessionCookie = cookie.trim().split(";")[0];
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { ...writes, cookie: sessionCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await x.app.inject({
          url: "/api/supervisor/overview",
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects unverified email, unauthorized signup, and mismatched invitation email", async () => {
    const x = await setup(),
      m = await manager(x);
    const claims = {
      iss: x.config.oidcIssuer,
      sub: "new-sub",
      email: "worker@example.com",
      email_verified: true,
    };
    expect(
      (await callback(x, { ...claims, email_verified: false })).statusCode,
    ).toBe(403);
    expect((await callback(x, claims)).statusCode).toBe(403);
    const invitation = (
      await x.app.inject({
        method: "POST",
        url: "/api/auth/invitations",
        headers: { ...writes, cookie: m.cookie },
        payload: { email: "different@example.com", workerId: fixtureId(1) },
      })
    ).json();
    expect(
      (await callback(x, claims, invitation.invitationCode)).statusCode,
    ).toBe(403);
  });
  it("redeems verified worker invitation only once and workers cannot invite", async () => {
    const x = await setup(),
      m = await manager(x);
    const response = await x.app.inject({
      method: "POST",
      url: "/api/auth/invitations",
      headers: { ...writes, cookie: m.cookie },
      payload: { email: "worker@example.com", workerId: fixtureId(1) },
    });
    expect(response.statusCode).toBe(200);
    const invitation = response.json();
    const claims = {
      iss: x.config.oidcIssuer,
      sub: "worker-sub",
      email: "worker@example.com",
      email_verified: true,
    };
    expect(
      (await callback(x, claims, invitation.invitationCode)).statusCode,
    ).toBe(302);
    const account = (
      await x.repo.driver.query(
        "SELECT id FROM auth_accounts WHERE subject=$1",
        ["worker-sub"],
      )
    )[0];
    const cookie = `siteguard_session=${await createAccountSession(x.repo, String(account.id))}`;
    expect(
      (await x.app.inject({ url: "/api/workers", headers: { cookie } })).json()
        .workers,
    ).toHaveLength(1);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/invitations",
          headers: { ...writes, cookie },
          payload: { email: "other@example.com", workerId: fixtureId(2) },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await callback(
          x,
          { ...claims, sub: "other-sub" },
          invitation.invitationCode,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("checks disabled account/site membership and refuses bootstrap elevation", async () => {
    const x = await setup(),
      m = await manager(x);
    await expect(
      bootstrapManager(x.repo, {
        issuer: x.config.oidcIssuer!,
        subject: "manager-sub",
        email: "manager@example.com",
        siteId: x.config.siteId,
      }),
    ).rejects.toThrow("elevate");
    await x.repo.driver.query(
      "UPDATE auth_accounts SET site_id=$1 WHERE id=$2",
      ["different-site", m.id],
    );
    expect(
      (
        await x.app.inject({
          url: "/api/auth/me",
          headers: { cookie: m.cookie },
        })
      ).json().identity,
    ).toBeNull();
    await x.repo.driver.query(
      "UPDATE auth_accounts SET site_id=$1,disabled=1 WHERE id=$2",
      [x.config.siteId, m.id],
    );
    expect(
      (
        await x.app.inject({
          url: "/api/auth/me",
          headers: { cookie: m.cookie },
        })
      ).json().identity,
    ).toBeNull();
  });
  it("requires expected origin plus JSON for cookie-authenticated writes", async () => {
    const x = await setup(),
      m = await manager(x);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: m.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            ...writes,
            origin: "https://evil.example.com",
            cookie: m.cookie,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { ...writes, cookie: m.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const frame = await x.app.inject({
      method: "POST",
      url: `/api/sessions/${fixtureId(1001)}/frame?timestampUs=1`,
      headers: {
        origin: x.config.appOrigin,
        cookie: `siteguard_session=${await createAccountSession(x.repo, m.id)}`,
        "content-type": "image/jpeg",
      },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    // JPEG camera frames pass the same-origin guard, then are rejected by
    // normal session authorization because supervisors cannot write frames.
    expect(frame.statusCode).toBe(403);
    expect(frame.json().error.code).toBe("FORBIDDEN");
  });
  it("rejects callback without transaction and does not reuse consumed transactions", async () => {
    const x = await setup();
    expect(
      (await x.app.inject("/api/auth/callback?code=fake")).statusCode,
    ).toBe(401);
    mocks.grant.mockRejectedValue(new Error("invalid state"));
    const start = await x.app.inject("/api/auth/login");
    const cookie = String(start.headers["set-cookie"]).split(";")[0];
    expect(
      (
        await x.app.inject({
          url: "/api/auth/callback?code=bad",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await x.app.inject({
          url: "/api/auth/callback?code=bad",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(mocks.grant).toHaveBeenCalledTimes(1);
  });
  it("blocks hosted legacy login regardless DEMO_MODE", async () => {
    const x = await setup({
      hosted: true,
      appOrigin: "https://siteguard.example.com",
    });
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/demo/login",
          headers: { origin: x.config.appOrigin },
          payload: { role: "supervisor" },
        })
      ).statusCode,
    ).toBe(403);
  });
});
