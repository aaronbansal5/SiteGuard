import { test, expect } from "@playwright/test";
import type { Break, RestRequest } from "@siteguard/contracts";
test("real-time mock check-in → summary → request → protected staffing change", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.request.post("/api/demo/reset", { data: {} });
  await page.request.post("/api/auth/logout", { data: {} });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A better view of the break." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open worker portal" }).click();
  await page.getByRole("link", { name: "Start voluntary check-in" }).click();
  await page.getByLabel("I understand the limitations").check();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Settle in. Observe the change." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No camera required", { exact: true }),
  ).toBeVisible();
  const id = /sessions\/([^/]+)\/measure/.exec(page.url())![1];
  // Exercise the actual backend cadence, not injected/accelerated readings.
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/sessions/${id}/readings`);
        return r.ok() ? r.json().then((b) => b.readings.length) : 0;
      },
      { timeout: 70000, intervals: [2000] },
    )
    .toBeGreaterThanOrEqual(60);
  await page.getByRole("button", { name: "Finish check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next step, with context." }),
  ).toBeVisible();
  await expect(page.getByText("Observed change", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    page.getByText("4 matching prior sessions", { exact: false }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Measurement evidence" }),
  ).toBeVisible();
  await expect(page.getByText(/^(60|61)$/, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Local demo storage", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("10s", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Request additional rest" }).click();
  await page.getByLabel("Additional minutes").fill("5");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(
    page.getByText("Additional rest requested.", { exact: false }),
  ).toBeVisible();
  const context = await browser.newContext();
  const supervisor = await context.newPage();
  await supervisor.goto("/");
  await supervisor
    .getByRole("button", { name: "Open safety operations" })
    .click();
  const before = (
    await (await supervisor.request.get("/api/breaks")).json()
  ).breaks.filter((b: Break) => b.kind === "protected");
  await expect(
    supervisor.getByRole("heading", {
      name: "Extra break requested · 5 minutes",
    }),
  ).toBeVisible();
  await supervisor
    .getByRole("button", { name: "Approve rest", exact: true })
    .click();
  await supervisor.getByRole("button", { name: "Confirm approve" }).click();
  await expect(
    supervisor.getByText("Approved rest:", { exact: false }),
  ).toBeVisible();
  const after = (
    await (await supervisor.request.get("/api/breaks")).json()
  ).breaks.filter((b: Break) => b.kind === "protected");
  expect(after).toEqual(before);
  await page.getByRole("button", { name: "Report a symptom" }).click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(
    supervisor.getByRole("heading", { name: "Help requested" }),
  ).toBeVisible();
  await expect(supervisor.getByText("Reported: Feeling dizzy")).toBeVisible();
  await supervisor
    .getByRole("button", { name: "Acknowledge", exact: true })
    .click();
  await supervisor.getByRole("button", { name: "Confirm acknowledge" }).click();
  await expect(
    supervisor.getByText("acknowledged", { exact: true }),
  ).toBeVisible();
  const overview = await (
    await supervisor.request.get("/api/supervisor/overview")
  ).json();
  expect(
    overview.requests.find((r: RestRequest) => r.kind === "assistance").status,
  ).toBe("acknowledged");
  await context.close();
});
