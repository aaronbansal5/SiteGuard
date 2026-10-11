import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
const provider = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: provider }),
}));
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const item of apps.splice(0)) await item.app.close();
  vi.resetAllMocks();
});
const headers = { origin: "http://127.0.0.1:3001", host: "127.0.0.1:3001" };
const user = (
  email = "worker@example.com",
  id = "00000000-0000-4000-8000-000000000008",
) => ({
  id,
  email,
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: "Jordan", role: "supervisor" },
});
async function setup(authAdditionalOrigins: string[] = []) {
  const item = await createApp({
    authMode: "supabase",
    authAdditionalOrigins,
    appOrigin: headers.origin,
    supabaseUrl: "https://test.supabase.co",
    supabasePublishableKey: "sb_publishable_fixture",
    supabaseAdminEmail: "admin@example.com",
    databaseUrl: undefined,
    sqlitePath: ":memory:",
    cookieSecret: "cookie-secret-at-least-32-characters",
    measurementToken: "internal-test-token",
    webDist: "/nonexistent",
  });
  apps.push(item);
  return item;
}
function authenticated(email?: string, id?: string) {
  provider.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: "verified-jwt" } },
    error: null,
  });
  provider.getUser.mockResolvedValue({
    data: { user: user(email, id) },
    error: null,
  });
}
async function login(
  app: Awaited<ReturnType<typeof setup>>["app"],
  email = "worker@example.com",
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/password/login",
    headers,
    payload: { email, password: "fixture-password" },
  });
}
describe("Supabase account auth", () => {
  it("lets a native iPhone pair and upload without a browser origin", async () => {
    const item = await createApp({
      authMode: "supabase",
      appOrigin: headers.origin,
      supabaseUrl: "https://test.supabase.co",
      supabasePublishableKey: "sb_publishable_fixture",
      supabaseAdminEmail: "admin@example.com",
      checkInTestMode: true,
      demoMode: true,
      hosted: false,
      databaseUrl: undefined,
      sqlitePath: ":memory:",
      cookieSecret: "cookie-secret-at-least-32-characters",
      measurementToken: "internal-test-token",
      webDist: "/nonexistent",
    });
    apps.push(item);
    const { app } = item;
    authenticated();
    const response = await login(app);
    const cookie = response.cookies.find(
      (entry) => entry.name === "siteguard_session",
    )!;
    const tls = { "x-siteguard-public-proto": "https" };
    const issued = await app.inject({
      method: "POST",
      url: "/api/devices/pairings",
      headers: { ...headers, ...tls, cookie: `${cookie.name}=${cookie.value}` },
      payload: {},
    });
    expect(issued.statusCode).toBe(201);
    // A cross-site browser page still cannot drive the exchange.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/devices/pair",
          headers: { ...tls, origin: "https://evil.example" },
          payload: { code: issued.json().code },
        })
      ).statusCode,
    ).toBe(403);
    // The phone sends neither a cookie nor an Origin header.
    const paired = await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      headers: tls,
      payload: { code: issued.json().code },
    });
    expect(paired.statusCode).toBe(201);
    expect(paired.json().workerId).toBe(response.json().identity.workerId);
    expect(paired.json().displayName).toBe("Jordan");
    const startedAt = new Date(Date.now() - 5000).toISOString();
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/device/check-ins",
      headers: { ...tls, authorization: `Bearer ${paired.json().deviceToken}` },
      payload: {
        id: "00000000-0000-4000-8000-00000000f001",
        startedAt,
        endedAt: new Date(Date.now() - 1000).toISOString(),
        consentVersion: "v1",
        shareWithSupervisor: true,
        context: { workload: null, temperatureC: null },
        readings: [
          {
            sequence: 0,
            reading: {
              timestamp: new Date(Date.now() - 3000).toISOString(),
              heartRateBpm: 72,
              respiratoryRateBrpm: 15,
              quality: "valid",
              source: "presage",
            },
          },
        ],
      },
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().recommendation.suggestedMinutes).toBeGreaterThan(0);
  });

  it("creates a dedicated worker, ignores metadata roles, isolates access and revokes logout sessions", async () => {
    const { app, repo } = await setup();
    authenticated();
    expect((await app.inject({ url: "/api/workers" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/login",
          headers,
          payload: { role: "supervisor" },
        })
      ).statusCode,
    ).toBe(403);
    const response = await login(app);
    expect(response.statusCode).toBe(200);
    expect(response.json().identity.role).toBe("worker");
    expect(response.headers["set-cookie"]?.toString()).toContain("HttpOnly");
    const cookie = response.cookies.find(
      (item) => item.name === "siteguard_session",
    )!;
    const authenticatedHeaders = {
      ...headers,
      cookie: `${cookie.name}=${cookie.value}`,
    };
    expect(
      (
        await app.inject({
          url: "/api/supervisor/overview",
          headers: authenticatedHeaders,
        })
      ).statusCode,
    ).toBe(403);
    const workers = (
      await app.inject({ url: "/api/workers", headers: authenticatedHeaders })
    ).json().workers;
    expect(workers).toHaveLength(1);
    expect(workers[0].id).toBe(response.json().identity.workerId);
    expect(
      (await repo.driver.query("SELECT role FROM auth_accounts"))[0].role,
    ).toBe("worker");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: authenticatedHeaders,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({ url: "/api/auth/me", headers: authenticatedHeaders })
      ).json().identity,
    ).toBeNull();
  });
  it("grants supervisor only to the configured verified email", async () => {
    const { app } = await setup();
    authenticated("admin@example.com");
    const response = await login(app, "admin@example.com");
    expect(response.json().identity.role).toBe("supervisor");
    const cookie = response.cookies.find(
      (item) => item.name === "siteguard_session",
    )!;
    expect(
      (
        await app.inject({
          url: "/api/supervisor/overview",
          headers: { cookie: `${cookie.name}=${cookie.value}` },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("does not provision an account for unconfirmed email or failed credentials", async () => {
    const { app, repo } = await setup();
    authenticated("admin@example.com");
    provider.getUser.mockResolvedValue({
      data: {
        user: { ...user("admin@example.com"), email_confirmed_at: null },
      },
      error: null,
    });
    expect((await login(app, "admin@example.com")).statusCode).toBe(401);
    expect(
      await repo.driver.query("SELECT id FROM auth_accounts"),
    ).toHaveLength(0);
    provider.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Secret provider details" },
    });
    const failure = await login(app);
    expect(failure.statusCode).toBe(401);
    expect(failure.body).not.toContain("Secret provider details");
  });
  it.each([
    ["email_address_not_authorized", 422, 503, "AUTH_EMAIL_CONFIGURATION"],
    ["signup_disabled", 422, 503, "SIGNUP_DISABLED"],
    ["over_email_send_rate_limit", 429, 429, "SIGNUP_RATE_LIMITED"],
    ["weak_password", 422, 400, "WEAK_PASSWORD"],
    ["unexpected_failure", 500, 503, "AUTH_UNAVAILABLE"],
  ])(
    "reports signup provider failure %s without leaking credentials",
    async (code, status, expectedStatus, expectedCode) => {
      const { app, repo } = await setup();
      provider.signUp.mockResolvedValue({
        data: { session: null },
        error: { code, status, message: "Private provider payload" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/password/signup",
        headers,
        payload: {
          email: "another-worker@gmail.com",
          password: "fixture-password",
          displayName: "Worker",
        },
      });
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json().error.code).toBe(expectedCode);
      expect(response.body).not.toContain("Private provider payload");
      expect(
        await repo.driver.query("SELECT id FROM auth_accounts"),
      ).toHaveLength(0);
    },
  );
  it("allows signup with any email and creates separate worker profiles after verification", async () => {
    const { app, repo } = await setup();
    for (const [index, address] of [
      "worker-one@gmail.com",
      "worker-two@outlook.com",
    ].entries()) {
      const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
      provider.signUp.mockResolvedValue({
        data: { session: { access_token: "verified-jwt" } },
        error: null,
      });
      provider.getUser.mockResolvedValue({
        data: { user: user(address, id) },
        error: null,
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/password/signup",
        headers,
        payload: {
          email: address,
          password: "fixture-password",
          displayName: "Worker",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().identity.role).toBe("worker");
      expect(provider.signUp).toHaveBeenLastCalledWith(
        expect.objectContaining({ email: address }),
      );
    }
    const accounts = await repo.driver.query(
      "SELECT role,worker_id FROM auth_accounts",
    );
    expect(accounts).toHaveLength(2);
    expect(new Set(accounts.map((account) => account.worker_id)).size).toBe(2);
    expect(accounts.every((account) => account.role === "worker")).toBe(true);
  });
  it("rejects role fields and missing origin; confirmation signup cannot log in early", async () => {
    const { app, repo } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/password/signup",
          headers,
          payload: {
            email: "admin@example.com",
            password: "fixture-password",
            displayName: "Jordan",
            role: "supervisor",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/password/login",
          payload: {
            email: "worker@example.com",
            password: "fixture-password",
          },
        })
      ).statusCode,
    ).toBe(403);
    provider.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/password/signup",
      headers,
      payload: {
        email: "worker@example.com",
        password: "fixture-password",
        displayName: "Jordan",
      },
    });
    expect(response.json().signedIn).toBe(false);
    expect(
      await repo.driver.query("SELECT token_digest FROM auth_sessions"),
    ).toHaveLength(0);
    expect(provider.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: headers.origin + "/login?confirmed=1",
        }),
      }),
    );
  });
  it("accepts explicitly configured Vite origin and rejects untrusted origins before password verification", async () => {
    const { app } = await setup(["http://127.0.0.1:5173"]);
    authenticated();
    const request = (origin: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/password/login",
        headers: { origin, host: "127.0.0.1:5173" },
        payload: { email: "worker@example.com", password: "fixture-password" },
      });
    expect((await request("http://127.0.0.1:5173")).statusCode).toBe(200);
    expect((await request("https://untrusted.example")).statusCode).toBe(403);
    expect(provider.signInWithPassword).toHaveBeenCalledTimes(1);
  });
  it("disabled accounts remain disabled and repeat sign-in preserves worker identity", async () => {
    const { app, repo } = await setup();
    authenticated();
    const first = await login(app),
      second = await login(app);
    expect(first.json().identity.workerId).toBe(
      second.json().identity.workerId,
    );
    await repo.driver.query("UPDATE auth_accounts SET disabled=1");
    expect((await login(app)).statusCode).toBe(403);
  });
  it("reset confirms provider identity, updates password and revokes app sessions", async () => {
    const { app, repo } = await setup();
    authenticated();
    await login(app);
    for (const method of [
      provider.setSession,
      provider.updateUser,
      provider.signOut,
    ])
      method.mockResolvedValue({ error: null });
    provider.setSession.mockResolvedValue({
      data: { user: user() },
      error: null,
    });
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      headers,
      payload: {
        accessToken: "verified-jwt",
        refreshToken: "refresh-token",
        password: "new-fixture-password",
      },
    });
    expect(result.statusCode).toBe(200);
    expect(
      await repo.driver.query("SELECT token_digest FROM auth_sessions"),
    ).toHaveLength(0);
    expect(provider.updateUser).toHaveBeenCalledWith({
      password: "new-fixture-password",
    });
  });
});
