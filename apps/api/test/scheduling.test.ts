import { describe, it, expect } from "vitest";
import { fixtures, fixtureId } from "@siteguard/mock-data";
import type { Schedule, RestRequest } from "@siteguard/contracts";
import {
  planSchedule,
  validateAssignments,
  coverageGaps,
} from "../src/domain/scheduling.js";
const now = Date.parse("2026-10-10T15:00:00.000Z");
const iso = (m: number) => new Date(now + m * 60000).toISOString();
function schedule(): Schedule {
  const f = fixtures(now);
  return { ...f, requests: [], scheduleRevision: 0 };
}
function request(
  kind: "assistance" | "additional_rest",
  status: RestRequest["status"] = "pending",
): RestRequest {
  return {
    id: fixtureId(600),
    workerId: fixtureId(1),
    sessionId: null,
    kind,
    requestedMinutes: kind === "assistance" ? null : 5,
    status,
    createdAt: iso(0),
    restStartsAt: null,
    restEndsAt: null,
    revision: 0,
    note: null,
  };
}
describe("protected break planner", () => {
  it("covers tasks without modifying protected breaks", () => {
    const s = schedule(),
      before = JSON.stringify(s.breaks),
      p = planSchedule(s);
    expect(p.coverageGaps).toHaveLength(0);
    expect(JSON.stringify(s.breaks)).toBe(before);
    expect(() => validateAssignments(s, p.assignments)).not.toThrow();
  });
  it("respects overlapping break intervals", () => {
    const s = schedule();
    s.breaks.push({
      ...s.breaks[0],
      id: fixtureId(700),
      startsAt: iso(10),
      endsAt: iso(30),
    });
    const p = planSchedule(s);
    expect(
      p.assignments
        .filter((a) => a.workerId === fixtureId(1))
        .every(
          (a) =>
            Date.parse(a.endsAt) <= Date.parse(iso(-2)) ||
            Date.parse(a.startsAt) >= Date.parse(iso(30)),
        ),
    ).toBe(true);
  });
  it.each(["pending", "acknowledged"] as const)(
    "retains unresolved assistance block after %s",
    (status) => {
      const s = schedule();
      s.requests = [request("assistance", status)];
      const p = planSchedule(s);
      expect(
        p.assignments
          .filter((a) => a.workerId === fixtureId(1))
          .every((a) => Date.parse(a.endsAt) <= now),
      ).toBe(true);
      expect(s.requests[0].status).toBe(status);
    },
  );
  it("pending additional rest blocks until explicitly handled", () => {
    const s = schedule();
    s.requests = [request("additional_rest")];
    expect(
      planSchedule(s)
        .assignments.filter((a) => a.workerId === fixtureId(1))
        .every((a) => Date.parse(a.endsAt) <= now),
    ).toBe(true);
  });
  it("surfaces staffing gaps when everyone is unavailable", () => {
    const s = schedule();
    s.availability = [];
    expect(planSchedule(s).assignments).toHaveLength(0);
    expect(planSchedule(s).coverageGaps.length).toBeGreaterThan(0);
  });
  it("rejects conflicting assignments", () => {
    const s = schedule();
    const p = planSchedule(s);
    expect(() =>
      validateAssignments(s, [
        p.assignments[0],
        { ...p.assignments[0], id: fixtureId(888) },
      ]),
    ).toThrow("Overlapping");
  });
  it("rejects workers without task skills", () => {
    const s = schedule();
    const a = {
      id: fixtureId(999),
      taskId: fixtureId(202),
      workerId: fixtureId(6),
      startsAt: iso(0),
      endsAt: iso(1),
    };
    expect(() => validateAssignments(s, [a])).toThrow("skills");
  });
  it("allows half-open intervals that touch a protected break", () => {
    const s = schedule();
    const a = {
      id: fixtureId(999),
      taskId: fixtureId(201),
      workerId: fixtureId(1),
      startsAt: iso(13),
      endsAt: iso(14),
    };
    expect(() => validateAssignments(s, [a])).not.toThrow();
  });
  it("reserves existing assignments across all tasks before filling earlier tasks", () => {
    const s = schedule();
    s.breaks = [];
    s.tasks = s.tasks.map((task) => ({
      ...task,
      requiredSkills: [],
      startsAt: iso(0),
      endsAt: iso(10),
      staffingRequired: 1,
    }));
    s.assignments = [
      {
        id: fixtureId(998),
        taskId: s.tasks[1].id,
        workerId: fixtureId(1),
        startsAt: iso(0),
        endsAt: iso(10),
      },
    ];
    const p = planSchedule(s);
    expect(
      p.assignments.find(
        (a) => a.workerId === fixtureId(1) && a.taskId === s.tasks[1].id,
      ),
    ).toMatchObject({ startsAt: iso(0), endsAt: iso(10) });
    expect(p.coverageGaps).toHaveLength(0);
  });
  it("preserves valid portions of assignments when a request arrives", () => {
    const s = schedule();
    s.assignments = planSchedule(s).assignments;
    s.requests = [{ ...request("assistance"), createdAt: iso(40) }];
    const p = planSchedule(s);
    expect(
      p.assignments
        .filter((a) => a.workerId === fixtureId(1))
        .every((a) => Date.parse(a.endsAt) <= Date.parse(iso(40))),
    ).toBe(true);
    expect(coverageGaps(s, p.assignments)).toHaveLength(0);
  });
});
