import { expect, it } from "vitest";
import { testApp, login, populatedSession } from "./helpers.js";
it("limits concurrent streams per identity, releases quota on disconnect, and leaves the measurement session active", async () => {
  const { app, repo } = await testApp();
  const streams: Response[] = [];
  try {
    const s = await populatedSession(repo);
    const cookie = await login(app);
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${base}/api/sessions/${s.id}/events`;
    for (let i = 0; i < 6; i++) {
      const stream = await fetch(url, { headers: { cookie } });
      expect(stream.status).toBe(200);
      streams.push(stream);
    }
    const rejected = await fetch(url, { headers: { cookie } });
    expect(rejected.status).toBe(429);
    expect((await rejected.json()).error.code).toBe("STREAM_LIMIT");
    await streams.shift()!.body!.cancel();
    await expect
      .poll(async () => {
        const response = await fetch(url, { headers: { cookie } });
        if (response.status === 200) {
          streams.push(response);
          return 200;
        }
        await response.arrayBuffer();
        return response.status;
      })
      .toBe(200);
    expect((await repo.get("sessions", s.id))?.status).toBe("active");
  } finally {
    await Promise.all(streams.map((r) => r.body?.cancel()));
    await app.close();
  }
});
it("closes an existing SSE stream when its signed identity expires at heartbeat", async () => {
  const { app, repo } = await testApp();
  let response: Response | undefined;
  try {
    const s = await populatedSession(repo);
    const value = JSON.stringify({
      identity: { role: "worker", workerId: s.workerId },
      expiresAt: Date.now() + 1000,
    });
    const cookie = `siteguard=${encodeURIComponent(app.signCookie(value))}`;
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    response = await fetch(`${base}/api/sessions/${s.id}/events`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let output = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    expect(output).toContain('"code":"UNAUTHENTICATED"');
    expect((await repo.get("sessions", s.id))?.status).toBe("active");
    reader.releaseLock();
  } finally {
    await response?.body?.cancel();
    await app.close();
  }
}, 10000);
