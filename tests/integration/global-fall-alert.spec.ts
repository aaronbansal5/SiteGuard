import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";

test("persisted incident pulses worker, manager and phone pages until shared acknowledgment", async ({
  browser,
  baseURL,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL })),
  );
  const [worker, manager, phone] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  await phone.setViewportSize({ width: 390, height: 844 });
  try {
    await manager.request.post("/api/demo/login", {
      data: { role: "supervisor" },
    });
    expect(
      (await manager.request.post("/api/demo/reset", { data: {} })).ok(),
    ).toBe(true);
    await manager.request.post("/api/demo/login", {
      data: { role: "supervisor" },
    });
    for (const page of [worker, phone])
      await page.request.post("/api/demo/login", {
        data: { role: "worker", workerId: fixtureId(1) },
      });
    await Promise.all([
      worker.goto("/history"),
      manager.goto("/supervisor"),
      phone.goto("/mobile"),
    ]);
    for (const page of [worker, manager, phone])
      await expect(page.locator("body")).not.toHaveClass(/fall-alert-active/);
    const eventId = randomUUID();
    const created = await manager.request.post("/api/safety/events", {
      headers: {
        authorization: `Bearer ${process.env.E2E_MEASUREMENT_TOKEN || "e2e-internal-token"}`,
      },
      data: {
        protocolVersion: 1,
        eventId,
        cameraId: "test-camera",
        zoneId: "test-zone",
        detectorRunId: randomUUID(),
        sequence: 0,
        trackId: "test-person",
        observedAt: new Date().toISOString(),
        kind: "possible_person_down",
        source: "synthetic",
        method: "bbox-aspect-v1",
        durationSeconds: 0,
        evidence: { heightWidthRatio: 0.5, region: [0.1, 0.2, 0.4, 0.3] },
      },
    });
    expect(created.status()).toBe(201);
    for (const page of [worker, manager, phone]) {
      await expect(
        page.getByRole("alert", { name: "Site incident alert" }),
      ).toBeVisible();
      const alert = page.getByRole("alert", { name: "Site incident alert" });
      await expect(alert.getByText("test-zone", { exact: true })).toBeVisible();
      await expect(alert.getByText("test-camera", { exact: true })).toBeVisible();
      await expect(alert.locator("time")).toHaveCount(1);
      await expect(alert.getByText("Acknowledging stops the shared alert. It does not resolve the incident.")).toBeVisible();
      await expect(alert.getByRole("link", { name: "View scene & follow up" })).toBeVisible();
      await expect(page.locator("body")).toHaveClass(/fall-alert-active/);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.body, "::before").animationName,
        ),
      ).toBe("fall-screen-flash");
    }
    await worker.screenshot({ path: ".data/alert-desktop.png" });
    await phone.screenshot({ path: ".data/alert-phone.png" });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Changing routes cannot silence an unacknowledged incident.
    await worker
      .getByRole("navigation")
      .getByRole("link", { name: "Worker portal" })
      .click();
    await expect(worker.locator("body")).toHaveClass(/fall-alert-active/);
    await worker.getByRole("button", { name: "Acknowledge alerts" }).click();
    for (const page of [worker, manager, phone]) {
      await expect(page.locator("body")).not.toHaveClass(/fall-alert-active/);
      await expect(
        page.getByRole("alert", { name: "Site incident alert" }),
      ).toHaveCount(0);
    }
    const state = await (
      await manager.request.get("/api/fall-detection/state")
    ).json();
    expect(
      state.incidents.find(
        (incident: { id: string }) => incident.id === eventId,
      ).status,
    ).toBe("acknowledged");
    await worker.goto("/fall-detection");
    await expect(
      worker.getByText("Possible person down", { exact: true }),
    ).toBeVisible();
    await expect(
      worker.getByText("acknowledged", { exact: true }),
    ).toBeVisible();
    expect(
      (await manager.request.post("/api/demo/reset", { data: {} })).ok(),
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("acknowledging one location keeps other open locations alerting", async ({ page }) => {
  await page.request.post("/api/demo/login", { data: { role: "worker", workerId: fixtureId(1) } });
  const incidents = ["North scaffold", "Loading bay"].map((zoneId) => ({
    id: randomUUID(), zoneId, cameraId: "site-camera-02", status: "open", revision: 1,
    observedAt: new Date().toISOString(),
  }));
  await page.route("**/api/fall-detection/state", route => route.fulfill({ json: { incidents } }));
  await page.route("**/api/safety/incidents/*", async route => {
    const id = route.request().url().split("/").pop();
    const incident = incidents.find(item => item.id === id)!;
    expect(route.request().postDataJSON()).toMatchObject({ action: "acknowledge", revision: 1 });
    incident.status = "acknowledged";
    await route.fulfill({ json: { incident } });
  });
  await page.goto("/history");
  const alert = page.getByRole("alert", { name: "Site incident alert" });
  await expect(alert.getByText("2 new alerts")).toBeVisible();
  await alert.locator("article").filter({ hasText: "North scaffold" }).getByRole("button").click();
  await expect(alert.getByText("North scaffold", { exact: true })).toHaveCount(0);
  await expect(alert.getByText("Loading bay", { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/fall-alert-active/);
  await alert.getByRole("button", { name: "Acknowledge alerts" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/fall-alert-active/);
});
