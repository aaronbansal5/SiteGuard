// Worker-only experimental personal insights (docs/RECOVERY_MODEL.md).
// Uses the shared seeded e2e database; leaves the rating it changes at the
// seeded value.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureId } from "@siteguard/mock-data";

test("worker sees a labeled personal comparison, trend and optional rating", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.goto(`/sessions/${fixtureId(1001)}`);
  const panel = page.locator("section.card.personal");
  await expect(
    panel.getByRole("heading", { name: "Compared with your own usual" }),
  ).toBeVisible();
  await expect(panel.getByText("Experimental", { exact: true })).toBeVisible();
  await expect(
    panel.getByText(
      /Compares only with your own past sessions · not medical advice · synthetic demo data/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(/^Your pulse (change was within|settled)/),
  ).toBeVisible();
  await expect(
    panel.getByText(/^Your recent sessions show your pulse/),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "Experimental estimate of how you might rate your tiredness",
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(/Includes synthetic demonstration ratings/),
  ).toBeVisible();
  await expect(panel).not.toContainText(/risk|diagnos|safe to work/i);

  const rating = panel.getByRole("group", { name: /Tiredness self-report/ });
  await rating.getByRole("radio", { name: /^2/ }).check();
  await expect(panel.getByRole("status")).toHaveText("Rating saved.");
  await expect(rating.getByRole("radio", { name: /^2/ })).toBeChecked();
  const result = await new AxeBuilder({ page })
    .include("section.card.personal")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await rating.getByRole("radio", { name: /^3/ }).check();
  await expect(rating.getByRole("radio", { name: /^3/ })).toBeChecked();

  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Your recent sessions" }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Your recent sessions show your breathing rate/),
  ).toBeVisible();
  await page.getByLabel("Source").selectOption("presage");
  await expect(
    page.getByText(/^A pulse trend needs at least 5 of your sessions/),
  ).toBeVisible();
});

test("supervisor views never show personal insights or self-reports", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  expect(
    (
      await page.request.get(
        `/api/sessions/${fixtureId(1001)}/personal-insights`,
      )
    ).status(),
  ).toBe(403);
  await page.goto("/supervisor");
  await page
    .getByRole("heading", { name: "Protected break schedule" })
    .waitFor();
  await expect(page.locator("body")).not.toContainText(
    /Compared with your own usual|tired|Experimental estimate/i,
  );
});
