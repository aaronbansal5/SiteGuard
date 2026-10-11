import { test, expect } from "@playwright/test";
import type { Session } from "@siteguard/contracts";
test("consent can be skipped and assistance requested without measurements", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  await page.getByRole("link", { name: "Start voluntary check-in" }).click();
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Skip measurement" }).click();
  await page
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await expect(
    page.getByText("Assistance request sent.", { exact: false }),
  ).toBeVisible();
});
test("API outage displays an error without a false success", async ({
  page,
}) => {
  await page.route("**/api/workers", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Demo service unavailable. Retry." },
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Demo service unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Open worker portal" }),
  ).toBeDisabled();
});
test("private physiological summary is inaccessible to supervisor", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  await page.goto("/history");
  const id = (
    await (
      await page.request.get(
        "/api/workers/00000000-0000-4000-8000-000000000001/history",
      )
    ).json()
  ).sessions.find((s: Session) => !s.shareWithSupervisor).id;
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByRole("alert")).toContainText(
    "Worker sharing consent is required",
  );
});
test("tablet worker portal has no horizontal overflow and keyboard controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Take a moment for yourself." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
});
