import { expect, it, vi } from "vitest";
import { testApp, populatedSession } from "./helpers.js";
import { PresageSource } from "../src/measurement/presage.js";
it("waits for an in-flight bridge start before stopping a measurement session", async () => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = vi
    .spyOn(PresageSource.prototype, "start")
    .mockImplementation(() => started);
  const stop = vi.spyOn(PresageSource.prototype, "stop").mockResolvedValue();
  const { app, repo, manager } = await testApp();
  try {
    const session = await populatedSession(repo);
    const starting = manager.start(session.id, "presage");
    const stopping = manager.stop(session.id);
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    release();
    await starting;
    await stopping;
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  } finally {
    release();
    await app.close();
    vi.restoreAllMocks();
  }
});
