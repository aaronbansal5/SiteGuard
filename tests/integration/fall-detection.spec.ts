import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
const incident = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "open",
  source: "synthetic",
  observedAt: new Date().toISOString(),
  cameraId: "fixture",
  zoneId: "test-zone",
  durationSeconds: 2.1,
  revision: 0,
};
test("worker sees shared scene queue and live camera without manager controls", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.route("**/api/fall-detection/state", (route) =>
    route.fulfill({
      json: {
        source: "camera",
        status: "running",
        cameraActive: true,
        canViewCamera: true,
        incidents: [incident],
      },
    }),
  );
  await page.route("**/api/fall-detection/preview", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/fall-detection");
  await expect(
    page.getByRole("heading", { name: "Scene monitoring" }),
  ).toBeVisible();
  await expect(
    page.getByText("Possible person down", { exact: true }),
  ).toBeVisible();
  await expect(page.getByAltText("Live scene camera feed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop camera" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", {
      name: "Scene note (required to save or close)",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save note" })).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Scene note (required to save or close)" })
    .fill("Checking the scene");
  await expect(
    page.getByRole("button", { name: "Resolve after check" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Call emergency services · 911 (US)" }),
  ).toHaveAttribute("href", "tel:911");
  expect((await page.request.get("/api/fall-detection/preview")).status()).toBe(
    200,
  );
});
test("manager sees boxes and commits revision checked scene review", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  let status = "open";
  await page.route("**/api/fall-detection/state", (route) =>
    route.fulfill({
      json: {
        source: "camera",
        status: "running",
        cameraActive: true,
        canViewCamera: true,
        frameSize: [640, 360],
        tracks: [{ trackId: "1", bbox: [10, 20, 150, 100], horizontal: true }],
        incidents: [{ ...incident, status }],
      },
    }),
  );
  await page.route("**/api/fall-detection/preview", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/safety/incidents/*", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({
      action: "resolve",
      revision: 0,
      note: "Checked scene",
    });
    status = "resolved";
    await route.fulfill({
      json: { incident: { ...incident, status, revision: 1 } },
    });
  });
  await page.goto("/fall-detection");
  await expect(page.getByAltText("Live scene camera feed")).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Anonymous person tracking boxes"] rect'),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Scene note (required to save or close)" })
    .fill("Checked scene");
  await page.getByRole("button", { name: "Resolve after check" }).click();
  await expect(page.getByText("resolved", { exact: true })).toBeVisible();
});
