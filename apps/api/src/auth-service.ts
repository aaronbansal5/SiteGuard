import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as oidc from "openid-client";
import type { Config } from "./config.js";
import type { Repository } from "./db/repository.js";
import { fail } from "./errors.js";
import {
  demoIdentity,
  identity,
  resolvedIdentity,
  setIdentity,
  supervisor,
} from "./auth.js";
export const tokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const requestSessionToken = (req: import("fastify").FastifyRequest) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : req.cookies.siteguard_session;
const token = () => randomBytes(32).toString("base64url");
const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const invitationSchema = z.strictObject({
  email: emailSchema,
  workerId: z.uuid(),
});
const cookieOptions = (c: Config) => ({
  httpOnly: true,
  secure: c.hosted,
  sameSite: "lax" as const,
  path: "/",
});
export async function bootstrapManager(
  r: Repository,
  input: { issuer: string; subject: string; email: string; siteId: string },
) {
  const email = emailSchema.parse(input.email);
  if (
    !input.subject ||
    input.subject.length > 512 ||
    new URL(input.issuer).protocol !== "https:"
  )
    throw new Error("Verified issuer and subject required");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.siteId))
    throw new Error("Invalid SITE_ID");
  return r.transaction(async (tx) => {
    const existing = await tx.driver.query(
      "SELECT id FROM auth_accounts WHERE issuer=$1 AND subject=$2",
      [input.issuer, input.subject],
    );
    if (existing.length)
      throw new Error(
        "Account already exists; bootstrap cannot elevate an existing account",
      );
    const id = randomUUID();
    await tx.driver.query(
      "INSERT INTO auth_accounts (id,issuer,subject,email,site_id,role,worker_id,disabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        input.issuer,
        input.subject,
        email,
        input.siteId,
        "supervisor",
        null,
        0,
        new Date().toISOString(),
      ],
    );
    return id;
  });
}
export async function createAccountSession(r: Repository, accountId: string) {
  const secret = token(),
    expiresAt = new Date(Date.now() + 8 * 3600000).toISOString();
  await r.driver.query(
    "INSERT INTO auth_sessions (token_digest,account_id,expires_at,created_at) VALUES ($1,$2,$3,$4)",
    [tokenDigest(secret), accountId, expiresAt, new Date().toISOString()],
  );
  return secret;
}
export async function sessionStillValid(
  r: Repository,
  c: Config,
  req: import("fastify").FastifyRequest,
) {
  const auth = resolvedIdentity(req);
  if (!auth || auth.expiresAt <= Date.now()) return false;
  if (c.authMode === "demo")
    return Boolean(
      auth.demoToken &&
      (
        await r.driver.query(
          "SELECT token_digest FROM auth_demo_sessions WHERE token_digest=$1 AND expires_at>$2",
          [tokenDigest(auth.demoToken), new Date().toISOString()],
        )
      ).length,
    );
  const rows = await r.driver.query(
    "SELECT a.id FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.expires_at>$2 AND a.disabled=0 AND a.site_id=$3",
    [
      tokenDigest(requestSessionToken(req) || ""),
      new Date().toISOString(),
      c.siteId,
    ],
  );
  return rows.length > 0;
}
export async function registerAuth(
  app: FastifyInstance,
  r: Repository,
  c: Config,
) {
  if (c.authMode === "oidc")
    await r.transaction(async (tx) => {
      const bound = (
        await tx.driver.query(
          "SELECT site_id FROM auth_deployment_site WHERE id=1",
        )
      )[0];
      if (bound && bound.site_id !== c.siteId)
        throw new Error(
          "Database is bound to a different SITE_ID; use a separate database per site",
        );
      if (!bound)
        await tx.driver.query(
          "INSERT INTO auth_deployment_site (id,site_id) VALUES (1,$1)",
          [c.siteId],
        );
    });
  let provider: Promise<oidc.Configuration> | undefined;
  const getProvider = () => {
    if (!provider) {
      provider = oidc.discovery(
        new URL(c.oidcIssuer!),
        c.oidcClientId!,
        c.oidcClientSecret,
        undefined,
        { timeout: 10 },
      );
      provider.catch(() => {
        provider = undefined;
      });
    }
    return provider;
  };
  app.addHook("preHandler", async (req) => {
    if (c.authMode === "demo" && !c.hosted) {
      const auth = demoIdentity(req);
      if (auth?.demoToken) {
        const row = (
          await r.driver.query(
            "SELECT payload FROM auth_demo_sessions WHERE token_digest=$1 AND expires_at>$2",
            [tokenDigest(auth.demoToken), new Date().toISOString()],
          )
        )[0];
        if (row && String(row.payload) === JSON.stringify(auth.identity))
          setIdentity(req, auth);
      }
      return;
    }
    const secret = requestSessionToken(req);
    if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return;
    const rows = await r.driver.query(
      "SELECT a.id,a.email,a.site_id,a.role,a.worker_id,a.disabled,s.expires_at FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.expires_at>$2",
      [tokenDigest(secret), new Date().toISOString()],
    );
    const a = rows[0];
    if (!a || Number(a.disabled) !== 0 || a.site_id !== c.siteId) return;
    if (a.role === "worker" && !(await r.get("workers", String(a.worker_id))))
      return;
    setIdentity(req, {
      identity:
        a.role === "supervisor"
          ? { role: "supervisor" }
          : { role: "worker", workerId: String(a.worker_id) },
      account: {
        id: String(a.id),
        email: String(a.email),
        siteId: String(a.site_id),
      },
      expiresAt: Date.parse(String(a.expires_at)),
    });
  });
  app.get("/api/auth/config", async () => ({
    mode: c.authMode,
    loginAvailable:
      c.authMode === "demo"
        ? !c.hosted
        : Boolean(c.oidcIssuer && c.oidcClientId),
    siteId: c.siteId,
  }));
  app.get("/api/auth/me", async (req) => ({
    identity: resolvedIdentity(req)?.identity ?? null,
    account: resolvedIdentity(req)?.account,
    mode: c.authMode,
  }));
  app.post("/api/auth/logout", async (req, reply) => {
    const demo = demoIdentity(req);
    if (demo?.demoToken)
      await r.driver.query(
        "DELETE FROM auth_demo_sessions WHERE token_digest=$1",
        [tokenDigest(demo.demoToken)],
      );
    if (requestSessionToken(req))
      await r.driver.query("DELETE FROM auth_sessions WHERE token_digest=$1", [
        tokenDigest(requestSessionToken(req)!),
      ]);
    if (req.cookies.siteguard_login)
      await r.driver.query(
        "DELETE FROM auth_login_transactions WHERE token_digest=$1",
        [tokenDigest(req.cookies.siteguard_login)],
      );
    for (const name of ["siteguard", "siteguard_session", "siteguard_login"])
      reply.clearCookie(name, { path: "/", secure: c.hosted });
    return { loggedOut: true };
  });
  app.get("/api/auth/mobile/start", async (req, reply) => {
    if (c.authMode !== "oidc")
      fail(403, "AUTH_DISABLED", "Account login is not configured");
    const q = z
      .strictObject({
        challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        invitation: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
      })
      .parse(req.query);
    return reply.redirect(
      `/api/auth/login?mobileChallenge=${q.challenge}${q.invitation ? `&invitation=${q.invitation}` : ""}`,
    );
  });
  app.post("/api/auth/mobile/exchange", async (req) => {
    if (c.authMode !== "oidc")
      fail(403, "AUTH_DISABLED", "Account login is not configured");
    const input = z
      .strictObject({
        code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        verifier: z
          .string()
          .min(43)
          .max(128)
          .regex(/^[A-Za-z0-9._~-]+$/),
      })
      .parse(req.body);
    const accountId = await r.transaction(async (tx) => {
      const rows = await tx.driver.query(
        "SELECT c.account_id,c.challenge,a.disabled,a.site_id FROM auth_mobile_codes c JOIN auth_accounts a ON a.id=c.account_id WHERE c.token_digest=$1 AND c.expires_at>$2",
        [tokenDigest(input.code), new Date().toISOString()],
      );
      const row = rows[0];
      if (
        !row ||
        row.challenge !==
          createHash("sha256").update(input.verifier).digest("base64url") ||
        Number(row.disabled) !== 0 ||
        row.site_id !== c.siteId
      )
        fail(
          401,
          "INVALID_MOBILE_CODE",
          "Sign in again to obtain a valid app session",
        );
      await tx.driver.query(
        "DELETE FROM auth_mobile_codes WHERE token_digest=$1",
        [tokenDigest(input.code)],
      );
      return String(row.account_id);
    });
    const session = await createAccountSession(r, accountId);
    return {
      token: session,
      expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
    };
  });
  app.get("/api/auth/login", async (req, reply) => {
    if (c.authMode !== "oidc")
      fail(403, "AUTH_DISABLED", "Account login is not configured");
    const query = z
      .strictObject({
        invitation: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
        mobileChallenge: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
      })
      .parse(req.query);
    const configuration = await getProvider();
    const verifier = oidc.randomPKCECodeVerifier(),
      challenge = await oidc.calculatePKCECodeChallenge(verifier),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    const secret = token();
    await r.transaction(async (tx) => {
      await tx.driver.query(
        "DELETE FROM auth_login_transactions WHERE expires_at<$1",
        [new Date().toISOString()],
      );
      if (req.cookies.siteguard_login)
        await tx.driver.query(
          "DELETE FROM auth_login_transactions WHERE token_digest=$1",
          [tokenDigest(req.cookies.siteguard_login)],
        );
      await tx.driver.query(
        "INSERT INTO auth_login_transactions (token_digest,payload,expires_at) VALUES ($1,$2,$3)",
        [
          tokenDigest(secret),
          JSON.stringify({
            verifier,
            state,
            nonce,
            invitation: query.invitation,
            mobileChallenge: query.mobileChallenge,
          }),
          new Date(Date.now() + 10 * 60000).toISOString(),
        ],
      );
    });
    reply.setCookie("siteguard_login", secret, {
      ...cookieOptions(c),
      maxAge: 600,
    });
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: `${c.appOrigin}/api/auth/callback`,
      scope: "openid email",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return reply.redirect(url.href);
  });
  app.get("/api/auth/callback", async (req, reply) => {
    if (c.authMode !== "oidc")
      fail(403, "AUTH_DISABLED", "Account login is not configured");
    const secret = req.cookies.siteguard_login;
    if (!secret) fail(401, "LOGIN_EXPIRED", "Start a new sign in");
    const transaction = await r.transaction(async (tx) => {
      const rows = await tx.driver.query(
        "SELECT payload FROM auth_login_transactions WHERE token_digest=$1 AND expires_at>$2",
        [tokenDigest(secret), new Date().toISOString()],
      );
      await tx.driver.query(
        "DELETE FROM auth_login_transactions WHERE token_digest=$1",
        [tokenDigest(secret)],
      );
      return rows[0];
    });
    reply.clearCookie("siteguard_login", { path: "/", secure: c.hosted });
    if (!transaction) fail(401, "LOGIN_EXPIRED", "Start a new sign in");
    const t = JSON.parse(String(transaction.payload));
    let claims: ReturnType<oidc.TokenEndpointResponseHelpers["claims"]>;
    try {
      const result = await oidc.authorizationCodeGrant(
        await getProvider(),
        new URL(req.url, c.appOrigin),
        {
          pkceCodeVerifier: t.verifier,
          expectedState: t.state,
          expectedNonce: t.nonce,
          idTokenExpected: true,
        },
      );
      claims = result.claims();
    } catch {
      fail(401, "LOGIN_FAILED", "Sign in could not be verified. Start again.");
    }
    if (
      !claims ||
      claims.email_verified !== true ||
      typeof claims.email !== "string"
    )
      fail(
        403,
        "VERIFIED_EMAIL_REQUIRED",
        "A verified email address is required",
      );
    const email = emailSchema.parse(claims.email);
    const accountId = await r.transaction(async (tx) => {
      let account = (
        await tx.driver.query(
          "SELECT * FROM auth_accounts WHERE issuer=$1 AND subject=$2",
          [claims.iss, claims.sub],
        )
      )[0];
      if (!account && t.invitation) {
        const invitation = (
          await tx.driver.query(
            "SELECT * FROM auth_invitations WHERE token_digest=$1 AND redeemed_at IS NULL AND expires_at>$2",
            [tokenDigest(t.invitation), new Date().toISOString()],
          )
        )[0];
        if (
          !invitation ||
          invitation.site_id !== c.siteId ||
          invitation.email !== email
        )
          fail(
            403,
            "INVITATION_REQUIRED",
            "Valid invitation matching your verified email is required",
          );
        const inviter = (
          await tx.driver.query(
            "SELECT role,site_id,disabled FROM auth_accounts WHERE id=$1",
            [invitation.created_by],
          )
        )[0];
        if (
          !inviter ||
          inviter.role !== "supervisor" ||
          inviter.site_id !== c.siteId ||
          Number(inviter.disabled) !== 0
        )
          fail(
            403,
            "INVITATION_REQUIRED",
            "The invitation issuer no longer has manager access",
          );
        if (
          (
            await tx.driver.query(
              "SELECT id FROM auth_accounts WHERE site_id=$1 AND worker_id=$2",
              [c.siteId, invitation.worker_id],
            )
          ).length
        )
          fail(409, "WORKER_LINKED", "Worker already has an account");
        const id = randomUUID();
        await tx.driver.query(
          "INSERT INTO auth_accounts (id,issuer,subject,email,site_id,role,worker_id,disabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            claims.iss,
            claims.sub,
            email,
            c.siteId,
            "worker",
            invitation.worker_id,
            0,
            new Date().toISOString(),
          ],
        );
        await tx.driver.query(
          "UPDATE auth_invitations SET redeemed_at=$1 WHERE id=$2",
          [new Date().toISOString(), invitation.id],
        );
        account = { id, site_id: c.siteId, disabled: 0 };
      }
      if (
        !account ||
        account.site_id !== c.siteId ||
        Number(account.disabled) !== 0
      )
        fail(
          403,
          "ACCOUNT_NOT_AUTHORIZED",
          "Ask your manager for access to this site",
        );
      if (account.email && account.email !== email)
        fail(
          403,
          "ACCOUNT_EMAIL_CHANGED",
          "Ask your administrator to review your account email change",
        );
      return String(account.id);
    });
    if (requestSessionToken(req))
      await r.driver.query("DELETE FROM auth_sessions WHERE token_digest=$1", [
        tokenDigest(requestSessionToken(req)!),
      ]);
    if (t.mobileChallenge) {
      const code = token();
      await r.driver.query(
        "INSERT INTO auth_mobile_codes (token_digest,account_id,challenge,expires_at) VALUES ($1,$2,$3,$4)",
        [
          tokenDigest(code),
          accountId,
          t.mobileChallenge,
          new Date(Date.now() + 120000).toISOString(),
        ],
      );
      return reply.redirect(`siteguard-worker://auth?code=${code}`);
    }
    reply.setCookie(
      "siteguard_session",
      await createAccountSession(r, accountId),
      { ...cookieOptions(c), maxAge: 8 * 3600 },
    );
    return reply.redirect("/");
  });
  app.post("/api/auth/invitations", async (req) => {
    supervisor(req);
    const account = resolvedIdentity(req)?.account;
    if (!account)
      fail(
        403,
        "ACCOUNT_REQUIRED",
        "Account login is required to invite workers",
      );
    const input = invitationSchema.parse(req.body);
    if (!(await r.get("workers", input.workerId)))
      fail(404, "NOT_FOUND", "Worker not found");
    const invitationCode = token(),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    await r.transaction(async (tx) => {
      if (
        (
          await tx.driver.query(
            "SELECT id FROM auth_accounts WHERE site_id=$1 AND worker_id=$2",
            [c.siteId, input.workerId],
          )
        ).length
      )
        fail(409, "WORKER_LINKED", "Worker already has an account");
      await tx.driver.query(
        "UPDATE auth_invitations SET expires_at=$1 WHERE worker_id=$2 AND site_id=$3 AND redeemed_at IS NULL",
        [new Date().toISOString(), input.workerId, c.siteId],
      );
      await tx.driver.query(
        "INSERT INTO auth_invitations (id,token_digest,email,site_id,worker_id,created_by,created_at,expires_at,redeemed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          tokenDigest(invitationCode),
          input.email,
          c.siteId,
          input.workerId,
          account.id,
          new Date().toISOString(),
          expiresAt,
          null,
        ],
      );
    });
    return {
      id,
      email: input.email,
      workerId: input.workerId,
      expiresAt,
      invitationCode,
      inviteUrl: `${c.appOrigin}/api/auth/login?invitation=${invitationCode}`,
      invitation: {
        id,
        email: input.email,
        workerId: input.workerId,
        expiresAt,
      },
    };
  });
  app.get("/api/auth/invitations", async (req) => {
    supervisor(req);
    if (!resolvedIdentity(req)?.account)
      fail(403, "ACCOUNT_REQUIRED", "Account login required");
    return {
      invitations: await r.driver.query(
        "SELECT id,email,worker_id AS workerId,expires_at AS expiresAt,redeemed_at AS redeemedAt FROM auth_invitations WHERE site_id=$1 ORDER BY created_at DESC",
        [c.siteId],
      ),
    };
  });
}
