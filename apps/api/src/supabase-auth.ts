import { randomUUID } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Repository } from "./db/repository.js";
import {
  createAccountSession,
  requestSessionToken,
  tokenDigest,
} from "./auth-service.js";
import { fail } from "./errors.js";

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const credentials = z.strictObject({
  email,
  password: z.string().min(1).max(256),
});
const signup = credentials.extend({
  password: z.string().min(8).max(256),
  displayName: z.string().trim().min(1).max(80),
});
const recovery = z.strictObject({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  password: z.string().min(8).max(256),
});

/** Only Supabase verifies credentials; only server-owned records assign app roles. */
export function registerSupabaseAuth(
  app: FastifyInstance,
  r: Repository,
  c: Config,
) {
  const issuer = `${c.supabaseUrl!.replace(/\/$/, "")}/auth/v1`;
  const client = () =>
    createClient(c.supabaseUrl!, c.supabasePublishableKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(8000),
            redirect: "error",
          }),
      },
    });
  async function verify(accessToken: string): Promise<User> {
    const { data, error } = await client().auth.getUser(accessToken);
    if (error && (error.status === 0 || (error.status || 0) >= 500))
      fail(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in service is temporarily unavailable. Please retry.",
      );
    if (
      error ||
      !data.user ||
      !data.user.email ||
      !data.user.email_confirmed_at ||
      data.user.is_anonymous
    )
      fail(
        401,
        "LOGIN_FAILED",
        "Sign-in could not be verified. Check your email confirmation and try again.",
      );
    return data.user;
  }
  async function establish(
    user: User,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const verifiedEmail = email.parse(user.email);
    const subject = z.uuid().parse(user.id);
    const account = await r.transaction(async (tx) => {
      let record = (
        await tx.driver.query(
          "SELECT * FROM auth_accounts WHERE issuer=$1 AND subject=$2",
          [issuer, subject],
        )
      )[0];
      if (
        record &&
        (Number(record.disabled) !== 0 || record.site_id !== c.siteId)
      )
        fail(
          403,
          "ACCOUNT_DISABLED",
          "This account cannot access this site. Contact your administrator.",
        );
      if (record && record.email !== verifiedEmail)
        fail(
          403,
          "ACCOUNT_EMAIL_CHANGED",
          "Ask your administrator to review your changed account email.",
        );
      if (!record) {
        const id = randomUUID(),
          isAdmin = verifiedEmail === c.supabaseAdminEmail;
        const workerId = isAdmin ? null : randomUUID();
        if (workerId)
          await tx.put("workers", {
            id: workerId,
            displayName:
              typeof user.user_metadata?.display_name === "string"
                ? user.user_metadata.display_name.slice(0, 80)
                : `Worker ${workerId.slice(0, 6)}`,
            skills: [],
          });
        await tx.driver.query(
          "INSERT INTO auth_accounts(id,issuer,subject,email,site_id,role,worker_id,disabled,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            issuer,
            subject,
            verifiedEmail,
            c.siteId,
            isAdmin ? "supervisor" : "worker",
            workerId,
            0,
            new Date().toISOString(),
          ],
        );
        record = {
          id,
          email: verifiedEmail,
          role: isAdmin ? "supervisor" : "worker",
          worker_id: workerId,
        };
        await tx.put("audit_events", {
          id: randomUUID(),
          actor: id,
          action: "supabase_account_created",
          entityId: id,
          before: null,
          after: { role: record.role, workerId },
          createdAt: new Date().toISOString(),
        });
      } else if (
        verifiedEmail === c.supabaseAdminEmail &&
        record.role !== "supervisor"
      ) {
        await tx.driver.query(
          "UPDATE auth_accounts SET role='supervisor',worker_id=NULL WHERE id=$1",
          [record.id],
        );
        await tx.driver.query("DELETE FROM auth_sessions WHERE account_id=$1", [
          record.id,
        ]);
        await tx.put("audit_events", {
          id: randomUUID(),
          actor: String(record.id),
          action: "supabase_configured_admin",
          entityId: String(record.id),
          before: { role: record.role },
          after: { role: "supervisor" },
          createdAt: new Date().toISOString(),
        });
        record = { ...record, role: "supervisor", worker_id: null };
      }
      if (requestSessionToken(req))
        await tx.driver.query(
          "DELETE FROM auth_sessions WHERE token_digest=$1",
          [tokenDigest(requestSessionToken(req)!)],
        );
      const session = await createAccountSession(tx, String(record.id));
      return { record, session };
    });
    reply.setCookie("siteguard_session", account.session, {
      httpOnly: true,
      secure: c.hosted,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 3600,
    });
    reply.clearCookie("siteguard", { path: "/", secure: c.hosted });
    return {
      signedIn: true,
      identity:
        account.record.role === "supervisor"
          ? { role: "supervisor" }
          : { role: "worker", workerId: String(account.record.worker_id) },
    };
  }
  app.post("/api/auth/password/login", async (req, reply) => {
    const input = credentials.parse(req.body);
    const { data, error } = await client().auth.signInWithPassword(input);
    if (error && (error.status === 0 || (error.status || 0) >= 500))
      fail(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in service is temporarily unavailable. Please retry.",
      );
    if (error || !data.session)
      fail(
        401,
        "LOGIN_FAILED",
        "Email or password is incorrect, or your email still needs confirmation.",
      );
    return establish(await verify(data.session.access_token), req, reply);
  });
  app.post("/api/auth/password/signup", async (req, reply) => {
    const input = signup.parse(req.body);
    const { data, error } = await client().auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { display_name: input.displayName },
        emailRedirectTo: `${c.appOrigin}/login?confirmed=1`,
      },
    });
    if (error) {
      // Log only provider diagnostics, never credentials, email or provider payloads.
      req.log.warn(
        { providerCode: error.code, providerStatus: error.status },
        "Supabase signup rejected",
      );
      if (error.code === "email_address_not_authorized")
        fail(
          503,
          "AUTH_EMAIL_CONFIGURATION",
          "Account creation is blocked by the site's email configuration. The administrator must configure Supabase SMTP to send confirmation emails to everyone.",
        );
      if (error.code === "signup_disabled")
        fail(
          503,
          "SIGNUP_DISABLED",
          "New accounts are disabled in Supabase. Contact the site administrator.",
        );
      if (error.status === 429 || error.code === "over_email_send_rate_limit")
        fail(
          429,
          "SIGNUP_RATE_LIMITED",
          "The sign-up service has reached its email or request limit. Please try again later.",
        );
      if (error.code === "weak_password")
        fail(
          400,
          "WEAK_PASSWORD",
          "Choose a stronger password that meets the site's password requirements.",
        );
      if (error.status === 0 || (error.status || 0) >= 500)
        fail(
          503,
          "AUTH_UNAVAILABLE",
          "Account creation is temporarily unavailable. Please retry or contact the site administrator.",
        );
      fail(
        400,
        "SIGNUP_FAILED",
        "Account creation could not be completed. Check the email and password, or try signing in if you already have an account.",
      );
    }
    if (data.session)
      return establish(await verify(data.session.access_token), req, reply);
    return {
      signedIn: false,
      message:
        "Check your email to confirm your account, then come back to sign in.",
    };
  });
  app.post("/api/auth/password/reset-request", async (req) => {
    const input = z.strictObject({ email }).parse(req.body);
    const { error } = await client().auth.resetPasswordForEmail(input.email, {
      redirectTo: `${c.appOrigin}/login?recovery=1`,
    });
    // Keep the reply independent of whether an email is registered.
    if (error)
      fail(
        error.status === 429 ? 429 : 503,
        "RESET_UNAVAILABLE",
        "Password reset could not be requested. Please try again later.",
      );
    return {
      message:
        "If that account exists, check your email for a password reset link.",
    };
  });
  app.post("/api/auth/password/reset", async (req) => {
    const input = recovery.parse(req.body),
      provider = client();
    const user = await verify(input.accessToken);
    const { data: recovered, error: sessionError } =
      await provider.auth.setSession({
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
      });
    if (sessionError || recovered.user?.id !== user.id)
      fail(
        401,
        "RESET_EXPIRED",
        "This password reset link expired. Request a new one.",
      );
    const { error } = await provider.auth.updateUser({
      password: input.password,
    });
    if (error)
      fail(
        400,
        "RESET_FAILED",
        "The password could not be updated. Use a new reset link and a stronger password.",
      );
    await r.driver.query(
      "DELETE FROM auth_sessions WHERE account_id IN (SELECT id FROM auth_accounts WHERE issuer=$1 AND subject=$2)",
      [issuer, user.id],
    );
    await provider.auth.signOut({ scope: "global" });
    return { message: "Password updated. Sign in with your new password." };
  });
}
