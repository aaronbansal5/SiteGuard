// Source metadata remains in records; workers no longer choose or see source badges.
import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
import type { Session } from "@siteguard/contracts";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(2) },
  });
});

test("history retains sessions but has no source column or selector", async ({
  page,
}) => {
  const sessions: Session[] = (
    await (
      await page.request.get(`/api/workers/${fixtureId(2)}/history`)
    ).json()
  ).sessions;
  expect(sessions.length).toBeGreaterThanOrEqual(4);
  expect(sessions.every((s) => s.source === "mock")).toBe(true);
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Session history", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Source", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Source", { exact: true })).toHaveCount(0);
  await expect(page.locator(".history-scroll tbody tr")).toHaveCount(
    sessions.length,
  );
  await expect(page.getByText("Synthetic demo", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Presage measurement", { exact: true }),
  ).toHaveCount(0);
});

test("summary and worker home have no source badges", async ({ page }) => {
  for (const path of [`/sessions/${fixtureId(1011)}`, "/worker"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByText("Synthetic demo", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Presage measurement", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".badge.source")).toHaveCount(0);
  }
});

test("recent sessions automatically fetch real camera history without offering demo options", async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route("**/api/workers/*/personal-trend?*", (route) => {
    requested.push(new URL(route.request().url()).searchParams.get("source")!);
    return route.continue();
  });
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Your recent sessions" }),
  ).toBeVisible();
  await expect.poll(() => requested).toEqual(["presage"]);
  await expect(page.locator(".source-select")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /demo|presage/i })).toHaveCount(
    0,
  );
});
