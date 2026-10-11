import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";

type CameraFixtureWindow = Window & {
  releaseTestCamera?: () => void;
  stoppedTestTracks?: number;
};

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.request.post("/api/demo/reset", { data: {} });
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
});

test("phone-width journey: explicit consent, synthetic measurement, result, rest request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/worker");
  await expect(
    page.getByRole("link", { name: "Start voluntary check-in", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Start voluntary check-in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Measurement source")).toHaveValue("mock");
  await expect(
    page.getByLabel("I understand the limitations"),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Share this session's summary"),
  ).not.toBeChecked();
  await page.getByLabel("I understand the limitations").check();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Settle in. Observe the change." }),
  ).toBeVisible();
  await expect(
    page.getByText("No camera required", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next step, with context." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Research rest support" }),
  ).toBeVisible();
  await expect(page.getByText("Temperature not recorded")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const signal = await page
    .getByRole("heading", { name: "Your research signal" })
    .boundingBox();
  const metrics = await page
    .getByRole("heading", { name: "Pulse", exact: true })
    .boundingBox();
  expect(signal!.y).toBeLessThan(metrics!.y);
  await page
    .getByRole("button", { name: "Request additional rest", exact: true })
    .click();
  await page.getByLabel("Additional minutes").fill("5");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(
    page.getByText("Additional rest requested.", { exact: false }),
  ).toBeVisible();
});

test("consent is fresh on return; missing break cannot submit", async ({
  page,
}) => {
  await page.goto(`/check-in?breakId=${fixtureId(101)}`);
  await page.getByLabel("I understand the limitations").check();
  await page.getByRole("link", { name: "Skip measurement" }).click();
  await page.getByRole("link", { name: "Start voluntary check-in", exact: true }).click();
  await expect(
    page.getByLabel("I understand the limitations"),
  ).not.toBeChecked();
  await page.goto("/check-in");
  await page.getByLabel("I understand the limitations").check();
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Open your active break from the worker home to begin."),
  ).toBeVisible();
});

test("source-check failure is recoverable without silently beginning a session", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/health", (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Source check unavailable" } },
        })
      : route.continue(),
  );
  await page.goto(`/check-in?breakId=${fixtureId(101)}`);
  await page.getByLabel("I understand the limitations").check();
  await expect(page.getByRole("alert")).toContainText(
    "Source check unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeDisabled();
  failed = false;
  await page.getByRole("button", { name: "Retry source check" }).click();
  await expect(
    page.getByRole("button", { name: "Begin check-in" }),
  ).toBeEnabled();
});

test("research and explanation failures retain rest request controls", async ({
  page,
}) => {
  await page.route("**/api/sessions/*/rest-support", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } }),
  );
  await page.route("**/api/insights/explain", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Explanation unavailable" } },
    }),
  );
  await page.goto(`/sessions/${fixtureId(1001)}`);
  await expect(
    page.getByText("Research estimate unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry research estimate" }),
  ).toBeVisible();
  await expect(
    page.getByText("Explanation unavailable", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request additional rest", exact: true }),
  ).toBeEnabled();
});

test("browser camera source requests custom input and reports denied permission", async ({
  page,
}) => {
  // UI fixture only: no real camera or Presage is claimed by this test.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException(
          "Camera access denied. Allow access in browser settings, or finish this check-in.",
          "NotAllowedError",
        );
      },
    });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        measurementSources: { mock: true, presage: true, browserCamera: true },
      },
    }),
  );
  let requestedInput: unknown;
  await page.route("**/api/sessions", async (route) => {
    const body = route.request().postDataJSON();
    requestedInput = body;
    const response = await route.fetch({
      postData: { ...body, source: "mock", input: undefined },
    });
    const value = await response.json();
    await route.fulfill({
      response,
      json: { ...value, session: { ...value.session, source: "presage" } },
    });
  });
  await page.route(/\/api\/sessions\/[^/]+$/, async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    await route.fulfill({
      response,
      json: { ...value, session: { ...value.session, source: "presage" } },
    });
  });
  await page.goto(`/check-in?breakId=${fixtureId(101)}`);
  await expect(page.getByLabel("Measurement source")).toHaveValue("presage");
  await page.getByLabel("I understand the limitations").check();
  await page.getByRole("button", { name: "Begin check-in" }).click();
  expect(requestedInput).toMatchObject({
    source: "presage",
    input: "custom",
    consentVersion: "v1",
  });
  await expect(page.getByRole("alert")).toContainText("Camera access denied");
  await expect(
    page.getByText("No camera required", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Finish check-in" }),
  ).toBeEnabled();
});

test("leaving measurement stops a camera permission response that arrives late", async ({
  page,
}) => {
  const response = await page.request.post("/api/sessions", {
    data: {
      breakId: fixtureId(101),
      source: "mock",
      consentVersion: "v1",
      shareWithSupervisor: false,
      context: { workload: null, temperatureC: null },
    },
  });
  expect(response.ok()).toBe(true);
  const { session } = await response.json();
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    await route.fulfill({
      response,
      json: { ...value, session: { ...value.session, source: "presage" } },
    });
  });
  await page.addInitScript(() => {
    const fixture = window as CameraFixtureWindow;
    fixture.stoppedTestTracks = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise((resolve) => {
          fixture.releaseTestCamera = () =>
            resolve({
              getTracks: () => [
                {
                  stop: () => {
                    fixture.stoppedTestTracks! += 1;
                  },
                },
              ],
            });
        }),
    });
  });
  await page.goto(`/sessions/${session.id}/measure?camera=browser`);
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as CameraFixtureWindow).releaseTestCamera,
      ),
    )
    .toBe("function");
  await page.getByRole("link", { name: "Worker portal", exact: true }).click();
  await page.evaluate(() =>
    (window as CameraFixtureWindow).releaseTestCamera!(),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as CameraFixtureWindow).stoppedTestTracks),
    )
    .toBe(1);
});
