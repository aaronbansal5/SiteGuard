import type { FastifyRequest } from "fastify";
import { LoginSchema, type Identity } from "@siteguard/contracts";
import { fail } from "./errors.js";
export type ResolvedAuth = {
  identity: Identity;
  account?: { id: string; email: string; siteId: string };
  expiresAt: number;
  demoToken?: string;
};
const resolved = new WeakMap<FastifyRequest, ResolvedAuth>();
export function setIdentity(req: FastifyRequest, auth: ResolvedAuth) {
  resolved.set(req, auth);
}
export function resolvedIdentity(req: FastifyRequest) {
  return resolved.get(req);
}
export function demoIdentity(req: FastifyRequest): ResolvedAuth | undefined {
  const signed = req.cookies.siteguard;
  if (!signed) return undefined;
  const unsigned = req.unsignCookie(signed);
  if (!unsigned.valid || !unsigned.value) return undefined;
  try {
    const payload = JSON.parse(unsigned.value);
    if (
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    )
      return undefined;
    return {
      identity: LoginSchema.parse(payload.identity),
      expiresAt: payload.expiresAt,
      demoToken: payload.authToken,
    };
  } catch {
    return undefined;
  }
}
export function identity(req: FastifyRequest): Identity {
  const auth = resolved.get(req);
  if (!auth || auth.expiresAt <= Date.now())
    fail(401, "UNAUTHENTICATED", "Sign in to continue");
  return auth.identity;
}
export function supervisor(req: FastifyRequest) {
  const actor = identity(req);
  if (actor.role !== "supervisor")
    fail(403, "FORBIDDEN", "Supervisor access required");
  return actor;
}
export function worker(req: FastifyRequest) {
  const actor = identity(req);
  if (actor.role !== "worker") fail(403, "FORBIDDEN", "Worker access required");
  return actor.workerId;
}
