import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
test.beforeEach(async ({ page }) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  const reset = await page.request.post("/api/demo/reset", { data: {} });
  expect(reset.ok()).toBe(true);
  await page.request.post("/api/auth/logout", { data: {} });
});
test("stale coverage proposal cannot overwrite a newer worker need", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.goto("/supervisor");
  await page.getByRole("button", { name: "Preview coverage proposal" }).click();
  await expect(
    page.getByRole("heading", { name: "Proposal ready" }),
  ).toBeVisible();
  const worker = await browser.newContext();
  try {
    await worker.request.post("/api/demo/login", {
      data: { role: "worker", workerId: fixtureId(1) },
    });
    await worker.request.post("/api/rest-requests", {
      data: { sessionId: null, kind: "assistance", requestedMinutes: null },
    });
    await expect(
      page.getByRole("button", { name: "Commit coverage proposal" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Preview coverage proposal" })
      .click();
    await expect(
      page.getByRole("button", { name: "Commit coverage proposal" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Commit coverage proposal" })
      .click();
    await expect(
      page.getByText("Coverage updated. Protected breaks preserved."),
    ).toBeVisible();
  } finally {
    await worker.close();
  }
});
test("dialog traps keyboard focus and returns it on Escape", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  const trigger = page.getByRole("button", { name: "Report a symptom" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Send request", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test("failed measurement loading retains independent assistance access", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  const id = fixtureId(987654);
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Session service unavailable" },
      }),
    }),
  );
  await page.goto(`/sessions/${id}/measure`);
  await expect(page.getByRole("alert")).toContainText(
    "Session service unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Request assistance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await expect(
    page.getByText("Assistance request sent.", { exact: false }),
  ).toBeVisible();
});
test("narrow screen forms and dialogs remain within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open worker portal" }).click();
  await page.getByRole("button", { name: "Report a symptom" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const dialog = await page.getByRole("dialog").boundingBox();
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Start check-in" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("slow API request becomes an explicit unconfirmed state", async ({
  page,
}) => {
  await page.route("**/api/workers", () => {});
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("took too long", {
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "Open worker portal" }),
  ).toBeDisabled();
});
