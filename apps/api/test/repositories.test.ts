import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { openRepository } from "../src/db/repository.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import { testApp, populatedSession } from "./helpers.js";
describe("persistence and ingestion", () => {
  it("deduplicates replay and rolls back an invalid batch", async () => {
    const { app, repo } = await testApp();
    try {
      const s = await populatedSession(repo);
      expect(await repo.ingest(s.id, [mockReading(s.startedAt, 0)])).toEqual({
        accepted: 0,
        duplicates: 1,
      });
      const conflicting = mockReading(s.startedAt, 0);
      conflicting.reading.heartRateBpm = 999;
      await expect(
        repo.ingest(s.id, [mockReading(s.startedAt, 60), conflicting]),
      ).rejects.toThrow("different");
      expect((await repo.readings(s.id)).length).toBe(60);
      await expect(
        repo.ingest(s.id, [
          {
            ...mockReading(s.startedAt, 60),
            reading: {
              ...mockReading(s.startedAt, 60).reading,
              source: "presage",
            },
          },
        ]),
      ).rejects.toThrow("source");
      await expect(
        repo.ingest(s.id, [
          mockReading(new Date(Date.now() + 60000).toISOString(), 0),
        ]),
      ).rejects.toThrow("outside");
    } finally {
      await app.close();
    }
  });
  it("isolates outside reads from a SQLite transaction that later rolls back", async () => {
    const { app, repo } = await testApp();
    try {
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const tx = repo.transaction(async (r) => {
        const worker = (await r.get("workers", fixtureId(1)))!;
        await r.put("workers", { ...worker, displayName: "Uncommitted" });
        entered();
        await gate;
        throw new Error("rollback fixture");
      });
      const failed = expect(tx).rejects.toThrow("rollback fixture");
      await ready;
      let readFinished = false;
      const read = repo.get("workers", fixtureId(1)).then((worker) => {
        readFinished = true;
        return worker;
      });
      await Promise.resolve();
      expect(readFinished).toBe(false);
      release();
      await failed;
      expect((await read)?.displayName).not.toBe("Uncommitted");
    } finally {
      await app.close();
    }
  });
  it("returns replay readings in sequence order even with out-of-order observation times", async () => {
    const { app, repo } = await testApp();
    try {
      const s = await populatedSession(repo);
      const later = mockReading(s.startedAt, 60),
        earlier = mockReading(s.startedAt, 59);
      earlier.sequence = 61;
      await repo.ingest(s.id, [later, earlier]);
      expect(
        (await repo.readings(s.id)).slice(-2).map((r) => r.sequence),
      ).toEqual([60, 61]);
    } finally {
      await app.close();
    }
  });
  it("persists across restart and marks interrupted sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "siteguard-")),
      path = join(dir, "db.sqlite");
    let first: Awaited<ReturnType<typeof createApp>> | undefined,
      second: typeof first;
    try {
      first = await createApp({
        sqlitePath: path,
        databaseUrl: undefined,
        webDist: "/nonexistent",
      });
      await populatedSession(first.repo);
      await first.app.close();
      first = undefined;
      second = await createApp({
        sqlitePath: path,
        databaseUrl: undefined,
        webDist: "/nonexistent",
      });
      const s = await second.repo.get("sessions", fixtureId(9000));
      expect(s?.status).toBe("completed");
      expect(s?.interruption).toContain("restart");
      expect((await second.repo.readings(fixtureId(9000))).length).toBe(60);
    } finally {
      await first?.app.close();
      await second?.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("resets the demo reproducibly with relational integrity", async () => {
    const r = await openRepository(
      loadConfig({ sqlitePath: ":memory:", databaseUrl: undefined }),
    );
    try {
      await seed(r);
      const ids = (await r.list("workers")).map((w) => w.id);
      await seed(r, true);
      expect((await r.list("workers")).map((w) => w.id)).toEqual(ids);
      expect((await r.list("sessions")).length).toBe(24);
      expect((await r.readings(fixtureId(1001))).length).toBe(60);
    } finally {
      await r.close();
    }
  });
});
