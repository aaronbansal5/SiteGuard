import { describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { testApp, login } from "./helpers.js";
import { fixtureId } from "@siteguard/mock-data";

const observation = () => ({
  protocolVersion: 1,
  eventId: randomUUID(),
  cameraId: "camera-01",
  zoneId: "north-yard",
  detectorRunId: randomUUID(),
  sequence: 1,
  trackId: "track-2",
  observedAt: new Date().toISOString(),
  kind: "possible_person_down",
  source: "synthetic",
  method: "bbox-aspect-v1",
  durationSeconds: 1.7,
  evidence: { heightWidthRatio: 0.4 },
});
describe("Safety incident integration", () => {
  test("internal event replay is idempotent; conflicting content rejected; workers cannot operate incidents", async () => {
    const h = await testApp();
    try {
      const worker = await login(h.app),
        event = observation();
      expect(
        (
          await h.app.inject({
            method: "GET",
            url: "/api/safety/incidents",
            headers: { cookie: worker },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/api/safety/events",
            payload: event,
          })
        ).statusCode,
      ).toBe(401);
      const ingest = (payload: Record<string, unknown>) =>
        h.app.inject({
          method: "POST",
          url: "/api/safety/events",
          headers: { authorization: "Bearer internal-test-token" },
          payload,
        });
      expect((await ingest(event)).statusCode).toBe(201);
      expect((await ingest(event)).json().duplicate).toBe(true);
      expect((await ingest({ ...event, durationSeconds: 2 })).statusCode).toBe(
        409,
      );
      expect(
        (await ingest({ ...event, eventId: randomUUID() })).statusCode,
      ).toBe(409);
      expect(
        (
          await ingest({
            ...observation(),
            observedAt: new Date(Date.now() + 60000).toISOString(),
          })
        ).statusCode,
      ).toBe(400);
      // The standalone detector also reports the normalized alert region.
      const withRegion = observation();
      withRegion.evidence = {
        heightWidthRatio: 0.4,
        region: [0.1, 0.2, 0.3, 0.4],
      } as typeof withRegion.evidence;
      expect((await ingest(withRegion)).statusCode).toBe(201);
      const manager = await login(h.app, "supervisor");
      const incidents = (
        await h.app.inject({
          method: "GET",
          url: "/api/safety/incidents",
          headers: { cookie: manager },
        })
      ).json().incidents;
      expect(incidents).toHaveLength(2);
      expect(incidents.map((i: { source: string }) => i.source)).toEqual([
        "synthetic",
        "synthetic",
      ]);
      expect(incidents[0].workerId).toBeNull();
    } finally {
      await h.app.close();
    }
  });
  test("human association creates assistance, acknowledgment and incident closure never clear planner block", async () => {
    const h = await testApp();
    try {
      const manager = await login(h.app, "supervisor"),
        headers = { cookie: manager };
      const protectedBefore = (await h.repo.list("breaks")).filter(
        (b) => b.kind === "protected",
      );
      const created = await h.app.inject({
        method: "POST",
        url: "/api/safety/demo",
        headers,
        payload: {},
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().incidentId;
      const action = (payload: Record<string, unknown>) =>
        h.app.inject({
          method: "PATCH",
          url: `/api/safety/incidents/${id}`,
          headers,
          payload,
        });
      expect(
        (await action({ action: "acknowledge", revision: 0, note: "" })).json()
          .incident.status,
      ).toBe("acknowledged");
      expect(await h.repo.list("rest_requests")).toHaveLength(0);
      expect(
        (
          await action({
            action: "associate",
            revision: 0,
            workerId: fixtureId(1),
            note: "Scene checked",
          })
        ).statusCode,
      ).toBe(409);
      const associated = await action({
        action: "associate",
        revision: 1,
        workerId: fixtureId(1),
        note: "Human matched fictional worker after scene check",
      });
      expect(associated.statusCode).toBe(200);
      const incident = associated.json().incident;
      const request = await h.repo.get(
        "rest_requests",
        incident.assistanceRequestId,
      );
      expect(request?.status).toBe("pending");
      expect(
        (await action({ action: "resolve", revision: 2, note: "" })).statusCode,
      ).toBe(400);
      expect(
        (
          await action({
            action: "resolve",
            revision: 2,
            note: "Scene follow-up recorded",
          })
        ).json().incident.status,
      ).toBe("resolved");
      expect(
        (await h.repo.get("rest_requests", incident.assistanceRequestId))
          ?.status,
      ).toBe("pending");
      const preview = (
        await h.app.inject({
          method: "POST",
          url: "/api/schedule/preview",
          headers,
          payload: {},
        })
      ).json();
      expect(
        preview.assignments.filter(
          (a: { workerId: string; endsAt: string }) =>
            a.workerId === fixtureId(1) &&
            Date.parse(a.endsAt) > Date.parse(request!.createdAt),
        ),
      ).toHaveLength(0);
      expect(
        (await h.repo.list("breaks")).filter((b) => b.kind === "protected"),
      ).toEqual(protectedBefore);
      expect(
        (await action({ action: "acknowledge", revision: 3, note: "" }))
          .statusCode,
      ).toBe(409);
    } finally {
      await h.app.close();
    }
  });
});
