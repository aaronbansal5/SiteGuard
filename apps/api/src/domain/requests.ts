import { randomUUID } from "node:crypto";
import type { Repository } from "../db/repository.js";
import type { Audit } from "@siteguard/contracts";
export async function audit(
  r: Repository,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  actor = "supervisor-demo",
): Promise<Audit> {
  const a: Audit = {
    id: randomUUID(),
    actor,
    action,
    entityId,
    before,
    after,
    createdAt: new Date().toISOString(),
  };
  await r.put("audit_events", a);
  return a;
}
