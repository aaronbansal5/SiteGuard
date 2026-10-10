import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
it("serves the production document at root and client routes, while missing assets remain 404", async () => {
  const dist = mkdtempSync(join(tmpdir(), "siteguard-static-"));
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>SiteGuard</title>",
  );
  const { app } = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    webDist: dist,
  });
  try {
    for (const url of ["/", "/worker", "/supervisor"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("<title>SiteGuard</title>");
    }
    for (const url of [
      "/assets/missing.js",
      "/missing.css",
      "/api/missing",
      "/api",
    ]) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
  } finally {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  }
});
