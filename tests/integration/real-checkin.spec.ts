import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.request.post("/api/demo/reset", { data: {} });
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
});

for (const path of ["/check-in", "/mobile"]) {
  test(`${path}: only real Presage can be started, with no synthetic fallback`, async ({
    page,
  }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        json: {
          measurementSources: {
            mock: true,
            presage: true,
            browserCamera: false,
          },
          checkInTestMode: false,
        },
      }),
    );
    const submitted: unknown[] = [];
    await page.route("**/api/sessions", (route) => {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "Presage camera unavailable. Check the bridge and retry.",
          },
        },
      });
    });
    await page.goto(path);
    if (path === "/mobile")
      await page
        .getByRole("button", { name: "Start check-in", exact: true })
        .click();
    await expect(
      page.getByLabel("Measurement source", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Check-in mode", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Synthetic demo · no camera", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel(/I understand the limitations/).check();
    await page.getByRole("button", { name: "Begin camera check-in" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Presage camera unavailable",
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ source: "presage" });
    await expect(
      page.getByRole("button", { name: "Begin camera check-in" }),
    ).toBeEnabled();
  });
}

test("phone: mock availability cannot enable a check-in when Presage is unavailable", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        measurementSources: {
          mock: true,
          presage: false,
          browserCamera: false,
        },
        checkInTestMode: false,
      },
    }),
  );
  await page.goto("/mobile");
  await expect(
    page.getByRole("button", { name: "Start check-in", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Camera check-in needs a running Presage bridge/),
  ).toBeVisible();
  await expect(page.getByText("Demo interval", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request assistance" }),
  ).toBeEnabled();
});
