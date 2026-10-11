import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureId } from "@siteguard/mock-data";
async function scan(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
test("landing meets automated WCAG AA checks", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("heading", { name: "A better view of the break." })
    .waitFor();
  await scan(page);
});
test("worker portal and symptom dialog meet automated WCAG AA checks", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.goto("/worker");
  await page
    .getByRole("heading", { name: "Take a moment for yourself." })
    .waitFor();
  await scan(page);
  await page.getByRole("button", { name: "Report a symptom" }).click();
  await page.getByRole("dialog").waitFor();
  await scan(page);
});
test("consent screen meets automated WCAG AA checks", async ({ page }) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.goto(`/check-in?breakId=${fixtureId(101)}`);
  await page.getByRole("heading", { name: "Ready to check in?" }).waitFor();
  await scan(page);
});
test("summary and charts meet automated WCAG AA checks", async ({ page }) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.goto(`/sessions/${fixtureId(1001)}`);
  await page.getByRole("heading", { name: "Your check-in results." }).waitFor();
  await page.getByText("View charts and history", { exact: true }).click();
  await page
    .getByRole("heading", { name: "Compared with your own usual" })
    .waitFor();
  await scan(page);
});
test("supervisor timeline meets automated WCAG AA checks", async ({ page }) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.goto("/supervisor");
  await page
    .getByRole("heading", { name: "Protected break schedule" })
    .waitFor();
  await scan(page);
});
