// Browser checks that every rendered session carries its source label.
// Read-only against the shared e2e database (no reset needed).
import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
import type { Session } from "@siteguard/contracts";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(2) },
  });
});

test("history labels every synthetic session as synthetic", async ({
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
    page.getByText("Synthetic demo", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toHaveCount(
    sessions.length,
  );
  await expect(
    page.getByText("Presage measurement", { exact: true }),
  ).toHaveCount(0);
});

test("summary and worker home show the synthetic badge", async ({ page }) => {
  await page.goto(`/sessions/${fixtureId(1011)}`);
  await expect(
    page.getByRole("heading", { name: "Your check-in results." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  await page.goto("/worker");
  await expect(
    page.getByText("Synthetic demo", { exact: true }).first(),
  ).toBeVisible();
});

test("a presage-sourced session renders the real-source badge, never the synthetic one", async ({
  page,
}) => {
  // The e2e server has no bridge, so rewrite a seeded session's source in
  // transit. This verifies the UI follows the record's source; it is not
  // evidence of a real Presage integration.
  const id = fixtureId(1011);
  const swap = (value: unknown): unknown =>
    JSON.parse(
      JSON.stringify(value).replaceAll('"source":"mock"', '"source":"presage"'),
    );
  for (const path of [
    `**/api/sessions/${id}`,
    `**/api/sessions/${id}/summary`,
    `**/api/sessions/${id}/readings`,
  ])
    await page.route(path, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: swap(await response.json()) });
    });
  await page.route("**/api/insights/explain", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "X",
          message: "Explanation unavailable",
          requestId: "x",
        },
      }),
    }),
  );
  await page.goto(`/sessions/${id}`);
  await expect(
    page.getByText("Presage measurement", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toHaveCount(
    0,
  );
});
