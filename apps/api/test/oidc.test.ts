import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign, createHash } from "node:crypto";
import { fixtureId } from "@siteguard/mock-data";
import { createApp } from "../src/app.js";
import { bootstrapManager, createAccountSession } from "../src/auth-service.js";
const issuer = "https://provider.example.com",
  origin = "http://127.0.0.1:3001",
  clientId = "siteguard-client";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const x of apps.splice(0)) await x.app.close();
});
function jwt(claims: Record<string, unknown>) {
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createSign("RSA-SHA256")
    .update(`${head}.${body}`)
    .sign(keys.privateKey)
    .toString("base64url");
  return `${head}.${body}.${signature}`;
}
async function setup() {
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    authMode: "oidc",
    appOrigin: origin,
    siteId: "oidc-fixture",
    oidcIssuer: issuer,
    oidcClientId: clientId,
    webDist: "/nonexistent",
  });
  apps.push(x);
  return x;
}
function fixtureProvider(getClaims: () => Record<string, unknown>) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes(".well-known"))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/token`)
        return Response.json({
          access_token: "fixture-access",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: jwt({
            iss: issuer,
            aud: clientId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...getClaims(),
          }),
        });
      throw new Error(`Unexpected fixture URL ${url}`);
    }),
  );
  return requests;
}
async function flow(
  x: Awaited<ReturnType<typeof setup>>,
  claims: Record<string, unknown>,
  invitation?: string,
  mutate?: "state" | "nonce",
  mobileChallenge?: string,
) {
  let nonce = "";
  const requests = fixtureProvider(() => ({
    ...claims,
    nonce: mutate === "nonce" ? "wrong-nonce" : nonce,
  }));
  const start = await x.app.inject(
    `/api/auth/login${invitation ? `?invitation=${invitation}` : mobileChallenge ? `?mobileChallenge=${mobileChallenge}` : ""}`,
  );
  expect(start.statusCode).toBe(302);
  const auth = new URL(String(start.headers.location));
  nonce = auth.searchParams.get("nonce")!;
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  const cookie = String(start.headers["set-cookie"]).split(";")[0];
  const response = await x.app.inject({
    url: `/api/auth/callback?code=fixture-code&state=${mutate === "state" ? "wrong-state" : auth.searchParams.get("state")}`,
    headers: { cookie },
  });
  return { response, requests };
}
describe("real OpenID client against signed HTTPS provider fixtures", () => {
  it("verifies signed manager ID token and established issuer/subject without role claims", async () => {
    const x = await setup();
    await bootstrapManager(x.repo, {
      issuer,
      subject: "manager-sub",
      email: "manager@example.com",
      siteId: x.config.siteId,
    });
    const { response, requests } = await flow(x, {
      sub: "manager-sub",
      email: "manager@example.com",
      email_verified: true,
      role: "worker",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
    expect(requests).toContain(`${issuer}/token`);
    const cookie = String(response.headers["set-cookie"])
      .split(",")
      .find((c) => c.includes("siteguard_session="))!
      .trim()
      .split(";")[0];
    expect(
      (await x.app.inject({ url: "/api/auth/me", headers: { cookie } })).json()
        .identity,
    ).toEqual({ role: "supervisor" });
  });
  it("creates invited worker and ignores attempted provider manager role claim", async () => {
    const x = await setup(),
      id = await bootstrapManager(x.repo, {
        issuer,
        subject: "manager-sub",
        email: "manager@example.com",
        siteId: x.config.siteId,
      });
    const cookie = `siteguard_session=${await createAccountSession(x.repo, id)}`;
    const invite = (
      await x.app.inject({
        method: "POST",
        url: "/api/auth/invitations",
        headers: { cookie, origin, "content-type": "application/json" },
        payload: { email: "worker@example.com", workerId: fixtureId(1) },
      })
    ).json();
    const { response } = await flow(
      x,
      {
        sub: "worker-sub",
        email: "worker@example.com",
        email_verified: true,
        role: "supervisor",
      },
      invite.invitationCode,
    );
    expect(response.statusCode).toBe(302);
    const account = (
      await x.repo.driver.query(
        "SELECT role,worker_id FROM auth_accounts WHERE subject=$1",
        ["worker-sub"],
      )
    )[0];
    expect(account).toMatchObject({ role: "worker", worker_id: fixtureId(1) });
  });
  it.each(["state", "nonce"] as const)(
    "rejects invalid %s with real protocol validation",
    async (mutate) => {
      const x = await setup();
      const { response } = await flow(
        x,
        { sub: "unknown", email: "worker@example.com", email_verified: true },
        undefined,
        mutate,
      );
      expect(response.statusCode).toBe(401);
      expect(
        await x.repo.driver.query("SELECT * FROM auth_sessions"),
      ).toHaveLength(0);
    },
  );
  it("rejects signed but unverified email", async () => {
    const x = await setup();
    const { response } = await flow(x, {
      sub: "unknown",
      email: "worker@example.com",
      email_verified: false,
    });
    expect(response.statusCode).toBe(403);
  });
  it("hands native client a one-use verifier-bound code and revocable opaque bearer session", async () => {
    const x = await setup();
    await bootstrapManager(x.repo, {
      issuer,
      subject: "manager-sub",
      email: "manager@example.com",
      siteId: x.config.siteId,
    });
    const verifier = "a".repeat(64),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    const { response } = await flow(
      x,
      {
        sub: "manager-sub",
        email: "manager@example.com",
        email_verified: true,
      },
      undefined,
      undefined,
      challenge,
    );
    expect(response.statusCode).toBe(302);
    const redirect = new URL(String(response.headers.location));
    expect(redirect.protocol).toBe("siteguard-worker:");
    const code = redirect.searchParams.get("code");
    const exchange = (value: string) =>
      x.app.inject({
        method: "POST",
        url: "/api/auth/mobile/exchange",
        payload: { code, verifier: value },
      });
    expect((await exchange("b".repeat(64))).statusCode).toBe(401);
    const grant = await exchange(verifier);
    expect(grant.statusCode).toBe(200);
    const session = grant.json().token;
    expect((await exchange(verifier)).statusCode).toBe(401);
    expect(
      (
        await x.app.inject({
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${session}` },
        })
      ).json().identity.role,
    ).toBe("supervisor");
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { authorization: `Bearer ${session}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await x.app.inject({
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${session}` },
        })
      ).json().identity,
    ).toBeNull();
  });
});
