import type { FastifyRequest } from "fastify";
import { LoginSchema, type Identity } from "@siteguard/contracts";
import { fail } from "./errors.js";
export function identity(req: FastifyRequest): Identity {
  const signed = req.cookies.siteguard;
  if (!signed) fail(401, "UNAUTHENTICATED", "Choose a demo role to continue");
  const unsigned = req.unsignCookie(signed);
  if (!unsigned.valid || !unsigned.value)
    fail(401, "UNAUTHENTICATED", "Demo identity expired");
  try {
    const payload = JSON.parse(unsigned.value);
    if (
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    )
      fail(401, "UNAUTHENTICATED", "Demo identity expired");
    return LoginSchema.parse(payload.identity);
  } catch {
    fail(401, "UNAUTHENTICATED", "Demo identity expired");
  }
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
