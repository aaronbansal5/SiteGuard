import type {
  Worker,
  Break,
  Task,
  Availability,
  Session,
  ReadingEnvelope,
  Assignment,
  SelfReport,
} from "@siteguard/contracts";
import { mockReading } from "./readings.js";
export function fixtureId(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
export function fixtures(now = Date.now()) {
  const iso = (m: number) => new Date(now + m * 60000).toISOString();
  const workers: Worker[] = Array.from({ length: 6 }, (_, i) => ({
    id: fixtureId(i + 1),
    displayName: `Worker W-0${i + 1}`,
    skills: i < 4 ? ["site", "equipment"] : ["site"],
  }));
  const breaks: Break[] = workers.map((w, i) => ({
    id: fixtureId(101 + i),
    workerId: w.id,
    startsAt: iso(i === 0 ? -2 : 5 + i * 5),
    endsAt: iso(i === 0 ? 13 : 20 + i * 5),
    kind: "protected",
    policyLabel: "Fictional site policy · 15 min minimum",
    revision: 0,
    requestId: null,
  }));
  const tasks: Task[] = [
    {
      id: fixtureId(201),
      label: "Material handling",
      requiredSkills: ["site"],
      startsAt: iso(-5),
      endsAt: iso(90),
      staffingRequired: 2,
    },
    {
      id: fixtureId(202),
      label: "Equipment inspection",
      requiredSkills: ["equipment"],
      startsAt: iso(-5),
      endsAt: iso(90),
      staffingRequired: 1,
    },
  ];
  const availability: Availability[] = workers.map((w, i) => ({
    id: fixtureId(301 + i),
    workerId: w.id,
    startsAt: iso(-10),
    endsAt: iso(120),
  }));
  const sessions: Session[] = [];
  const readings: { sessionId: string; envelope: ReadingEnvelope }[] = [];
  for (let i = 0; i < workers.length; i++)
    for (let h = 1; h <= 4; h++) {
      const start = new Date(now - h * 86400000 - i * 60000).toISOString();
      const id = fixtureId(1000 + i * 10 + h);
      sessions.push({
        id,
        workerId: workers[i].id,
        breakId: breaks[i].id,
        source: "mock",
        status: "completed",
        startedAt: start,
        endedAt: new Date(Date.parse(start) + 60000).toISOString(),
        context: { workload: "heavy", temperatureC: 26 },
        consentVersion: "v1",
        shareWithSupervisor: false,
        interruption: null,
      });
      for (let s = 0; s < 60; s++)
        readings.push({ sessionId: id, envelope: mockReading(start, s, h) });
    }
  // Older, clearly synthetic history so the worker-only personal recovery
  // baseline (docs/RECOVERY_MODEL.md) has enough same-source sessions to
  // render. A different workload/temperature context keeps these out of the
  // contextual comparison above. Settling speed varies deterministically.
  const rates = [0.8, 1.15, 0.9, 1.25, 0.75, 1.1, 0.95, 1.2];
  const selfReports: SelfReport[] = [];
  for (let i = 0; i < workers.length; i++)
    for (let k = 0; k < rates.length; k++) {
      const h = 5 + k;
      const rate = Math.round((rates[k] + ((i % 3) - 1) * 0.03) * 100) / 100;
      const start = new Date(now - h * 86400000 - i * 60000).toISOString();
      const id = fixtureId(5000 + i * 20 + k);
      sessions.push({
        id,
        workerId: workers[i].id,
        breakId: breaks[i].id,
        source: "mock",
        status: "completed",
        startedAt: start,
        endedAt: new Date(Date.parse(start) + 60000).toISOString(),
        context: { workload: "moderate", temperatureC: 18 },
        consentVersion: "v1",
        shareWithSupervisor: false,
        interruption: null,
      });
      for (let s = 0; s < 60; s++)
        readings.push({
          sessionId: id,
          envelope: mockReading(start, s, h, rate),
        });
      // Synthetic self-reports (labeled origin "synthetic"): a made-up
      // demonstration relationship, not evidence about real workers.
      selfReports.push({
        sessionId: id,
        workerId: workers[i].id,
        tiredness: Math.min(5, Math.max(1, Math.round(3 - (rate - 1) * 6))),
        origin: "synthetic",
        createdAt: new Date(Date.parse(start) + 61000).toISOString(),
      });
    }
  for (const x of sessions)
    if (x.context.workload === "heavy")
      selfReports.push({
        sessionId: x.id,
        workerId: x.workerId,
        tiredness: 3,
        origin: "synthetic",
        createdAt: new Date(Date.parse(x.endedAt!) + 1000).toISOString(),
      });
  return {
    workers,
    selfReports,
    breaks,
    tasks,
    availability,
    sessions,
    readings,
    assignments: [] as Assignment[],
  };
}
