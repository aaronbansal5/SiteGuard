// Phone check-in layout (/mobile, docs/MOBILE_APP.md) at a phone viewport.
// Each test resets the local demo first so W-01's protected break is active,
// and the file restores a clean demo afterwards.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureId } from "@siteguard/mock-data";
import type { Session } from "@siteguard/contracts";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

async function resetDemoAs(page: Page, workerId: string) {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  const reset = await page.request.post("/api/demo/reset", { data: {} });
  expect(reset.ok()).toBe(true);
  const login = await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId },
  });
  expect(login.ok()).toBe(true);
}

async function sessions(page: Page, workerId: string) {
  const r = await page.request.get(`/api/workers/${workerId}/history?limit=5`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { sessions: Session[] }).sessions;
}

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.request.post("http://127.0.0.1:5173/api/demo/login", {
    data: { role: "supervisor" },
  });
  await page.request.post("http://127.0.0.1:5173/api/demo/reset", {
    data: {},
  });
  await context.close();
});

test("phone: 60 s demo reminder counts down, prompts gently and never auto-starts", async ({
  page,
}) => {
  await page.clock.install();
  await resetDemoAs(page, fixtureId(1));
  await page.goto("/mobile");
  await expect(
    page.getByRole("heading", { name: "Check-in reminders" }),
  ).toBeVisible();
  await expect(page.getByText("Demo interval", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Check-in reminder every N seconds"),
  ).toHaveValue("60");
  const countdown = page.getByTestId("reminder-countdown");
  await expect(countdown).toHaveText("01:00");
  // Assistance needs no measurement and no consent.
  await expect(
    page.getByRole("button", { name: "Request assistance" }),
  ).toBeEnabled();

  await page.clock.runFor(30_000);
  await expect(countdown).toHaveText("00:30");
  await page.clock.runFor(31_000);
  const prompt = page
    .getByRole("status")
    .filter({ hasText: "Would you like to check in?" });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("CHECK-IN AVAILABLE · OPTIONAL");
  await expect(prompt).toContainText("Skipping has no effect");
  // The reminder never starts a measurement or skips consent.
  await page.clock.runFor(120_000);
  expect(
    (await sessions(page, fixtureId(1))).some((s) => s.status === "active"),
  ).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Before you begin" }),
  ).toHaveCount(0);

  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(countdown).toHaveText("01:00");

  await page.getByLabel("Check-in reminder every N seconds").fill("90");
  await page.getByRole("button", { name: "Set interval" }).click();
  await expect(countdown).toHaveText("01:30");
  await page.reload();
  await expect(
    page.getByLabel("Check-in reminder every N seconds"),
  ).toHaveValue("90");

  await page.getByLabel("Remind me to check in").uncheck();
  await expect(countdown).toHaveText("Off");
  await page.clock.runFor(300_000);
  await expect(page.getByText("Would you like to check in?")).toHaveCount(0);

  // Phone ergonomics: large touch targets, no horizontal scrolling.
  for (const control of await page
    .locator(".mobile-app button:visible, .mobile-app a.button:visible")
    .all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page })
    .include(".mobile-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("phone: consent every time, labeled synthetic check-in, insights after completion", async ({
  page,
}) => {
  await resetDemoAs(page, fixtureId(1));
  await page.goto("/mobile");
  await page.getByRole("button", { name: "Start check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Before you begin" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Phone browsers\s+cannot run the Presage SDK/),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  const begin = page.getByRole("button", { name: "Begin check-in" });
  await expect(begin).toBeDisabled();
  await page.getByLabel(/I understand the limitations/).check();
  await begin.click();

  await expect(
    page.getByRole("heading", { name: "Sit comfortably and rest." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Synthetic demonstration values, not a real measurement/),
  ).toBeVisible();
  const active = (await sessions(page, fixtureId(1))).find(
    (s) => s.status === "active",
  )!;
  expect(active.source).toBe("mock");
  expect(active.consentVersion).toBe("v1");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/sessions/${active.id}/readings`)
          ).json()
        ).readings.length,
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(3);
  // Support stays available during measurement.
  await expect(
    page.getByRole("button", { name: "Request assistance" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Finish check-in" }).click();

  await expect(
    page.getByRole("heading", { name: "Thanks for checking in." }),
  ).toBeVisible();
  const panel = page.locator("section.card.personal");
  await expect(
    panel.getByRole("heading", { name: "Compared with your own usual" }),
  ).toBeVisible();
  await expect(panel.getByText("Experimental", { exact: true })).toBeVisible();
  // A short check-in is described neutrally as not enough data.
  await expect(
    panel.getByText(/This check-in did not have enough valid pulse readings/),
  ).toBeVisible();
  await expect(page.locator(".mobile-app")).not.toContainText(
    /risk|diagnos|safe to work|fit for work|fatigue score/i,
  );

  await page.getByRole("button", { name: "Back to check-ins" }).click();
  await expect(page.getByTestId("reminder-countdown")).toHaveText(
    /^0[01]:\d\d$/,
  );
  // Consent is asked again on the next check-in and is not pre-filled.
  await page.getByRole("button", { name: "Start check-in" }).click();
  await expect(
    page.getByLabel(/I understand the limitations/),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(
    page.getByRole("heading", { name: "Check-in reminders" }),
  ).toBeVisible();
  expect(
    (await sessions(page, fixtureId(1))).filter((s) => s.status === "active"),
  ).toEqual([]);
});

test("phone: full 60 s synthetic check-in shows personal comparison", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetDemoAs(page, fixtureId(1));
  await page.goto("/mobile");
  await page.getByRole("button", { name: "Start check-in" }).click();
  await page.getByLabel(/I understand the limitations/).check();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Sit comfortably and rest." }),
  ).toBeVisible();
  const active = (await sessions(page, fixtureId(1))).find(
    (s) => s.status === "active",
  )!;
  // Real backend cadence (one synthetic reading per second).
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/sessions/${active.id}/readings`)
          ).json()
        ).readings.length,
      { timeout: 75000, intervals: [2000] },
    )
    .toBeGreaterThanOrEqual(60);
  await expect(page.getByText(/60 seconds reached/)).toBeVisible();
  await page.getByRole("button", { name: "Finish check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Thanks for checking in." }),
  ).toBeVisible();
  await expect(
    page.locator(".mobile-readings").getByText("Observed change"),
  ).toHaveCount(2);
  const panel = page.locator("section.card.personal");
  await expect(
    panel.getByText(/^Your pulse (change was within|settled)/),
  ).toBeVisible();
  await expect(
    panel.getByText(
      /Compares only with your own past sessions · not medical advice · synthetic demo data/,
    ),
  ).toBeVisible();
});

test("phone: outside a break, check-in is unavailable but assistance is not", async ({
  page,
}) => {
  await resetDemoAs(page, fixtureId(2));
  await page.goto("/mobile");
  await expect(page.getByText("No break in progress")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start check-in" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Check-ins open during your scheduled break/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request assistance" }).click();
  await expect(page.getByText(/Assistance request sent/)).toBeVisible();
  const requests = await (await page.request.get("/api/rest-requests")).json();
  expect(
    requests.requests.some(
      (r: { kind: string; sessionId: string | null }) =>
        r.kind === "assistance" && r.sessionId === null,
    ),
  ).toBe(true);
});
