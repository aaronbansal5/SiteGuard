import { randomUUID } from "node:crypto";
import type { Assignment, Schedule, Gap } from "@siteguard/contracts";
import { fail } from "../errors.js";
const t = Date.parse;
const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;
export function blocked(
  s: Schedule,
  workerId: string,
  start: number,
  end: number,
) {
  return (
    s.breaks.some(
      (b) =>
        b.workerId === workerId &&
        overlap(start, end, t(b.startsAt), t(b.endsAt)),
    ) ||
    s.requests.some(
      (r) =>
        r.workerId === workerId &&
        !["resolved", "declined"].includes(r.status) &&
        (r.kind === "assistance" || r.status !== "approved") &&
        end > t(r.createdAt),
    )
  );
}
export function assignmentIssue(
  s: Schedule,
  a: Assignment,
  others: Assignment[],
) {
  const start = t(a.startsAt),
    end = t(a.endsAt),
    worker = s.workers.find((w) => w.id === a.workerId),
    task = s.tasks.find((task) => task.id === a.taskId);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    return "Invalid assignment interval";
  if (!worker || !task) return "Unknown worker or task";
  if (start < t(task.startsAt) || end > t(task.endsAt))
    return "Assignment outside task interval";
  if (!task.requiredSkills.every((skill) => worker.skills.includes(skill)))
    return "Worker lacks task skills";
  if (
    !s.availability.some(
      (v) =>
        v.workerId === worker.id &&
        t(v.startsAt) <= start &&
        t(v.endsAt) >= end,
    )
  )
    return "Worker unavailable";
  if (blocked(s, worker.id, start, end))
    return "Assignment conflicts with a protected break or unresolved request";
  if (
    others.some(
      (o) =>
        o.workerId === worker.id &&
        overlap(start, end, t(o.startsAt), t(o.endsAt)),
    )
  )
    return "Overlapping worker assignments";
  return null;
}
export function validateAssignments(s: Schedule, assignments: Assignment[]) {
  const ids = new Set<string>();
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (ids.has(a.id))
      fail(409, "ASSIGNMENT_CONFLICT", "Duplicate assignment ID");
    ids.add(a.id);
    const issue = assignmentIssue(s, a, assignments.slice(0, i));
    if (issue) fail(409, "ASSIGNMENT_CONFLICT", issue);
  }
}
function boundaries(s: Schedule) {
  return [
    ...new Set([
      ...s.tasks.flatMap((x) => [t(x.startsAt), t(x.endsAt)]),
      ...s.breaks.flatMap((x) => [t(x.startsAt), t(x.endsAt)]),
      ...s.availability.flatMap((x) => [t(x.startsAt), t(x.endsAt)]),
      ...s.assignments.flatMap((x) => [t(x.startsAt), t(x.endsAt)]),
      ...s.requests.map((x) => t(x.createdAt)),
    ]),
  ].sort((a, b) => a - b);
}
export function coverageGaps(s: Schedule, assignments = s.assignments): Gap[] {
  const points = boundaries({ ...s, assignments });
  const result: Gap[] = [];
  for (let i = 0; i < points.length - 1; i++)
    for (const task of s.tasks) {
      const start = points[i],
        end = points[i + 1];
      if (start < t(task.startsAt) || end > t(task.endsAt)) continue;
      const valid = assignments.filter(
        (a) =>
          a.taskId === task.id &&
          t(a.startsAt) <= start &&
          t(a.endsAt) >= end &&
          !assignmentIssue(
            s,
            {
              ...a,
              startsAt: new Date(start).toISOString(),
              endsAt: new Date(end).toISOString(),
            },
            [],
          ),
      );
      const missing = task.staffingRequired - valid.length;
      if (missing > 0)
        result.push({
          taskId: task.id,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          missingWorkers: missing,
        });
    }
  return mergeGaps(result);
}
function mergeGaps(gaps: Gap[]) {
  const result: Gap[] = [];
  for (const taskId of [...new Set(gaps.map((g) => g.taskId))])
    for (const g of gaps.filter((g) => g.taskId === taskId)) {
      const p = result.at(-1);
      if (
        p &&
        p.taskId === g.taskId &&
        p.endsAt === g.startsAt &&
        p.missingWorkers === g.missingWorkers
      )
        p.endsAt = g.endsAt;
      else result.push({ ...g });
    }
  return result;
}
export function planSchedule(s: Schedule) {
  const points = boundaries(s);
  const assignments: Assignment[] = [];
  const minutes = new Map(s.workers.map((w) => [w.id, 0]));
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i],
      end = points[i + 1];
    if (end <= start) continue;
    const taskOrder = [...s.tasks].sort(
      (a, b) =>
        s.workers.filter((w) =>
          a.requiredSkills.every((k) => w.skills.includes(k)),
        ).length -
          s.workers.filter((w) =>
            b.requiredSkills.every((k) => w.skills.includes(k)),
          ).length || a.id.localeCompare(b.id),
    );
    // Reserve valid existing portions for every task before filling any gap.
    // Otherwise a replacement on an earlier task can steal another task's
    // already assigned worker.
    const reserved = new Map<string, number>();
    for (const existing of s.assignments) {
      if (t(existing.startsAt) > start || t(existing.endsAt) < end) continue;
      const a = {
        ...existing,
        id: randomUUID(),
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      };
      if (assignmentIssue(s, a, assignments)) continue;
      assignments.push(a);
      reserved.set(a.taskId, (reserved.get(a.taskId) || 0) + 1);
      minutes.set(a.workerId, minutes.get(a.workerId)! + (end - start) / 60000);
    }
    for (const task of taskOrder) {
      if (start < t(task.startsAt) || end > t(task.endsAt)) continue;
      const sorted = [
        ...[...s.workers]
          .sort(
            (a, b) =>
              minutes.get(a.id)! - minutes.get(b.id)! ||
              a.id.localeCompare(b.id),
          )
          .map((w) => w.id),
      ];
      let staffed = reserved.get(task.id) || 0;
      for (const workerId of [...new Set(sorted)]) {
        if (staffed >= task.staffingRequired) break;
        const a: Assignment = {
          id: randomUUID(),
          taskId: task.id,
          workerId,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
        };
        if (assignmentIssue(s, a, assignments)) continue;
        assignments.push(a);
        minutes.set(workerId, minutes.get(workerId)! + (end - start) / 60000);
        staffed++;
      }
    }
  }
  const merged: Assignment[] = [];
  for (const a of assignments) {
    const last = merged.findLast(
      (x) => x.workerId === a.workerId && x.taskId === a.taskId,
    );
    if (last && last.endsAt === a.startsAt) last.endsAt = a.endsAt;
    else merged.push({ ...a });
  }
  validateAssignments(s, merged);
  return {
    baseRevision: s.scheduleRevision,
    assignments: merged,
    coverageGaps: coverageGaps(s, merged),
  };
}
