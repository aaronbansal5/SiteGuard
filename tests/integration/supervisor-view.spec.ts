// "What safety operations can see" worker mirror and sharing withdrawal
// (docs/FEATURE_IDEAS.md, idea A1). Resets the shared e2e demo data before and
// after, because it creates a shared check-in for W-01.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureId } from "@siteguard/mock-data";
import type { RestRequest, Session } from "@siteguard/contracts";

test("worker sees what safety operations can see and stops sharing a check-in", async ({
  page,
  browser,
}) => {
  const supervisorContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  const supervisor = supervisorContext.request;
  await supervisor.post("/api/demo/login", { data: { role: "supervisor" } });
  expect((await supervisor.post("/api/demo/reset", { data: {} })).ok()).toBe(
    true,
  );

  // A shared, completed synthetic check-in during W-01's protected break,
  // linked to an assistance request via a symptom report.
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  const started = await page.request.post("/api/sessions", {
    data: {
      breakId: fixtureId(101),
      source: "mock",
      consentVersion: "v1",
      shareWithSupervisor: true,
      context: { workload: "heavy", temperatureC: 26 },
    },
  });
  expect(started.status()).toBe(201);
  const session = (await started.json()).session as Session;
  expect(
    (
      await page.request.post(`/api/sessions/${session.id}/complete`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const report = await page.request.post("/api/symptom-reports", {
    data: { sessionId: session.id, codes: ["headache"], note: null },
  });
  expect(report.status()).toBe(201);
  const request = (await report.json()).request as RestRequest;
  expect(
    (await supervisor.get(`/api/sessions/${session.id}/summary`)).status(),
  ).toBe(200);

  await page.goto("/worker");
  const mirror = page.locator("section.supervisor-mirror");
  await expect(
    mirror.getByRole("heading", { name: "What safety operations can see" }),
  ).toBeVisible();
  await expect(mirror.getByText("Headache")).toBeVisible();
  await expect(
    mirror.getByText("Linked from one of your requests"),
  ).toBeVisible();
  await expect(
    mirror.getByText("Your personal comparison, trend and tiredness ratings"),
  ).toBeVisible();
  await expect(mirror).not.toContainText(/risk score|diagnos|safe to work/i);
  const axe = await new AxeBuilder({ page })
    .include("section.supervisor-mirror")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await mirror.getByRole("button", { name: "Stop sharing" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Stop sharing this check-in?",
  });
  await expect(
    dialog.getByText(/any open assistance request stays open/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Stop sharing" }).click();
  await expect(mirror.getByRole("status")).toContainText("Sharing stopped.");
  await expect(
    mirror.getByText("None. Your check-in observations stay with you."),
  ).toBeVisible();

  // Supervisor access to the observations ended; the request did not.
  expect(
    (await supervisor.get(`/api/sessions/${session.id}/summary`)).status(),
  ).toBe(403);
  const overview = await (
    await supervisor.get("/api/supervisor/overview")
  ).json();
  const after = overview.requests.find((r: RestRequest) => r.id === request.id);
  expect(after.status).toBe("pending");
  expect(overview.sharedSessionIds).not.toContain(session.id);
  // The worker can still open their own summary.
  await page.goto(`/sessions/${session.id}`);
  await expect(
    page.getByRole("heading", { name: "Your check-in results." }),
  ).toBeVisible();

  expect((await supervisor.post("/api/demo/reset", { data: {} })).ok()).toBe(
    true,
  );
  await supervisorContext.close();
});
