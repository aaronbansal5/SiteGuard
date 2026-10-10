import type { Repository } from "../db/repository.js";
import { summarize, compare } from "./analytics.js";
import { fail } from "../errors.js";
export async function sessionSummary(repo: Repository, id: string) {
  const s = await repo.get("sessions", id);
  if (!s) fail(404, "NOT_FOUND", "Session not found");
  const summary = summarize(s, await repo.readings(id));
  const prior: { session: typeof s; summary: ReturnType<typeof summarize> }[] =
    [];
  if (
    s.context.workload !== null &&
    s.context.temperatureC !== null &&
    (summary.pulse.status === "available" ||
      summary.breathing.status === "available")
  ) {
    const band = (v: number) => (v < 20 ? 0 : v < 30 ? 1 : 2);
    let cursor: { startedAt: string; id: string } | undefined;
    while (true) {
      const history = await repo.sessionPage(s.workerId, 50, cursor, {
        source: s.source,
        since: new Date(Date.parse(s.startedAt) - 30 * 86400000).toISOString(),
        before: s.startedAt,
      });
      for (const session of history) {
        if (
          session.context.workload !== s.context.workload ||
          session.context.temperatureC === null ||
          band(session.context.temperatureC) !== band(s.context.temperatureC) ||
          !session.endedAt ||
          Date.parse(session.endedAt) > Date.parse(s.startedAt)
        )
          continue;
        prior.push({
          session,
          summary: summarize(session, await repo.readings(session.id)),
        });
        if (
          ["pulse", "breathing"].every((key) => {
            const metric = key as "pulse" | "breathing";
            return (
              summary[metric].status !== "available" ||
              prior.filter((p) => p.summary[metric].status === "available")
                .length >= 5
            );
          })
        )
          break;
      }
      if (
        history.length < 50 ||
        ["pulse", "breathing"].every((key) => {
          const metric = key as "pulse" | "breathing";
          return (
            summary[metric].status !== "available" ||
            prior.filter((p) => p.summary[metric].status === "available")
              .length >= 5
          );
        })
      )
        break;
      const last = history.at(-1)!;
      cursor = { startedAt: last.startedAt, id: last.id };
    }
  }
  return compare(s, summary, prior);
}
export async function interruptSessions(repo: Repository) {
  await repo.transaction(async (r) => {
    for (const s of await r.list("sessions"))
      if (s.status === "active") {
        s.status = "completed";
        s.endedAt = new Date().toISOString();
        s.interruption =
          "Session interrupted by an application restart. Available observations only.";
        await r.put("sessions", s);
      }
  });
}
