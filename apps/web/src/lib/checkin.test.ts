import { beforeEach, expect, it, vi } from "vitest";
import { startOrResumeCheckIn } from "./checkin";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const request = vi.mocked(api);
const preferences = {
  breakId: "break",
  source: "presage" as const,
  consentVersion: "local-test" as const,
  shareWithSupervisor: false,
  context: { workload: null, temperatureC: null },
};
beforeEach(() => request.mockReset());
it("resumes an existing camera session without starting another capture", async () => {
  const active = { id: "existing", status: "active", source: "presage" };
  request.mockResolvedValueOnce({ sessions: [active] });
  expect(await startOrResumeCheckIn("worker", preferences)).toEqual({
    session: active,
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it("completes the actual active synthetic session before creating a separate camera session", async () => {
  request
    .mockResolvedValueOnce({
      sessions: [{ id: "actual-active", status: "active", source: "mock" }],
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ session: { id: "new-camera" } });
  expect(await startOrResumeCheckIn("worker", preferences)).toEqual({
    session: { id: "new-camera" },
  });
  expect(request.mock.calls).toEqual([
    ["/workers/worker/history?limit=20"],
    ["/sessions/actual-active/complete", {}],
    ["/sessions", preferences],
  ]);
});
it("does not start another source when stopping the existing source fails", async () => {
  request
    .mockResolvedValueOnce({
      sessions: [{ id: "active", status: "active", source: "mock" }],
    })
    .mockRejectedValueOnce(new Error("Stop failed"));
  await expect(startOrResumeCheckIn("worker", preferences)).rejects.toThrow(
    "Stop failed",
  );
  expect(request).toHaveBeenCalledTimes(2);
});
