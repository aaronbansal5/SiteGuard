import { test, expect, type Page } from "@playwright/test";

const workerId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000009000";
async function fixture(
  page: Page,
  source: "mock" | "presage" = "presage",
  presentationSimulation = true,
) {
  const session = {
    id: sessionId,
    workerId,
    breakId: "00000000-0000-4000-8000-000000000101",
    source,
    status: "active",
    startedAt: new Date().toISOString(),
    endedAt: null,
    context: { workload: null, temperatureC: null },
    consentVersion: "local-test",
    shareWithSupervisor: false,
    interruption: null,
  };
  const metric = {
    status: "insufficient_data",
    initialMedian: null,
    finalMedian: null,
    delta: null,
    initialCount: 0,
    finalCount: 0,
  };
  const comparison = {
    status: "insufficient_data",
    count: 0,
    historicalMedianDelta: null,
  };
  const summary = {
    sessionId,
    source,
    context: session.context,
    durationSeconds: 90,
    pulse: metric,
    breathing: metric,
    pulseComparison: comparison,
    breathingComparison: comparison,
    limitations: [],
  };
  const state = {
    completionCalls: 0,
    failOnce: false,
    delayMs: 200,
    ambiguous: false,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body: unknown = {};
    if (path === "/auth/config")
      body = { mode: "demo", loginAvailable: true, siteId: "reliability" };
    else if (path === "/auth/me")
      body = { identity: { role: "worker", workerId } };
    else if (path === "/health")
      body = {
        status: "ok",
        checkInTestMode: true,
        presentationDemo: true,
        measurementSources: { mock: true, presage: true, browserCamera: false },
      };
    else if (path === "/workers")
      body = {
        workers: [{ id: workerId, displayName: "Test worker", skills: [] }],
      };
    else if (path === "/breaks") body = { breaks: [] };
    else if (path.includes("/history")) body = { sessions: [session] };
    else if (path.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"type":"status","state":"positioning","message":"Starting camera"}\n\n',
      });
    else if (path.endsWith("/preview")) return route.fulfill({ status: 204 });
    else if (path.endsWith("/complete")) {
      state.completionCalls++;
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.failOnce) {
        state.failOnce = false;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Camera stop failed. Retry completion." } },
        });
      }
      session.status = "completed";
      if (state.ambiguous)
        return route.fulfill({
          status: 502,
          json: { error: { message: "Response lost" } },
        });
      body = { session, summary };
    } else if (path === `/sessions/${sessionId}`) body = { session };
    else if (path.endsWith("/summary")) body = { summary };
    else if (path.endsWith("/readings")) body = { readings: [] };
    else if (path.endsWith("/rest-support"))
      body = {
        signal: "consider_additional_rest",
        confidence: null,
        uncertainty: {
          level: "unquantified",
          reasons: ["Camera evidence incomplete"],
        },
        evidence: {
          source,
          synthetic: false,
          durationSeconds: 90,
          pulse: null,
          breathing: null,
          issues: [],
        },
        modelVersion: "presentation-fixture",
        experimental: true,
        disclaimer: "Presentation simulation only",
        syntheticDemo: true,
        presentationSimulation,
        modelProvenance: { kind: "synthetic_demo", runtime_ready: false },
        demoModel: { status: "presentation_simulation", score: null },
      };
    else if (path === "/insights/explain")
      body = { origin: "deterministic", observations: [], limitations: [] };
    else if (
      path.endsWith("/timeseries-evidence") ||
      path.endsWith("/personal-insights")
    )
      return route.fulfill({
        status: 503,
        json: { error: { message: "Optional panel unavailable in fixture" } },
      });
    else if (path === "/devices/pairings") body = {};
    await route.fulfill({ json: body });
  });
  return { state, session, errors };
}

test("web timer finishes once despite repeated renders and a slow stop response", async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  await page.clock.install();
  await page.goto(`/sessions/${sessionId}/measure`);
  await expect(page.locator(".session-timer")).toContainText("01:30");
  state.delayMs = 1200;
  await page.clock.fastForward(92000);
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  await expect(
    page.getByText("Presentation result", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Demo scenario: a worker chooses/)).toBeVisible();
  expect(state.completionCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("failed automatic completion unlocks a working manual retry", async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  state.failOnce = true;
  await page.clock.install();
  await page.goto(`/sessions/${sessionId}/measure`);
  await expect(page.locator(".session-timer")).toBeVisible();
  await page.clock.fastForward(91000);
  await expect(
    page.getByRole("button", { name: "Finish check-in", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Camera stop failed. Retry completion."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish check-in", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  expect(state.completionCalls).toBe(2);
  expect(errors).toEqual([]);
});

test("ambiguous completion response reconciles persisted state without another write", async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  state.ambiguous = true;
  await page.goto(`/sessions/${sessionId}/measure`);
  await page
    .getByRole("button", { name: "Continue with presentation demo" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  expect(state.completionCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("phone countdown completes into the same labelled result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, errors } = await fixture(page);
  await page.clock.install();
  await page.goto("/mobile");
  await expect(page.getByTestId("checkin-elapsed")).toHaveText("01:30");
  await page.clock.fastForward(91000);
  await expect(
    page.getByRole("heading", { name: "Suggested next step" }),
  ).toBeVisible();
  await expect(
    page.getByText("Presentation result", { exact: true }),
  ).toBeVisible();
  expect(state.completionCalls).toBe(1);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("API restart status leaves the camera screen and opens the summary", async ({
  page,
}) => {
  const { state, session, errors } = await fixture(page);
  await page.clock.install();
  await page.goto(`/sessions/${sessionId}/measure`);
  await expect(page.locator(".session-timer")).toBeVisible();
  session.status = "completed";
  await page.clock.fastForward(6000);
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  expect(state.completionCalls).toBe(0);
  expect(errors).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`role-play shuffles without writing records or fabricating readings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { session, errors } = await fixture(page);
    session.status = "completed";
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        !request.url().endsWith("/insights/explain")
      )
        writes.push(request.url());
    });
    await page.goto(`/sessions/${sessionId}`);
    const playground = page.locator(".demo-playground");
    await expect(
      playground.getByText("Simulated role-play", { exact: true }),
    ).toBeVisible();
    await expect(playground.getByRole("heading")).toHaveText(
      "Take a moment. Request extra rest.",
    );
    for (let count = 0; count < 8; count++) {
      const previous = await playground.getByRole("heading").textContent();
      await playground
        .getByRole("button", { name: "Shuffle demo scenario" })
        .click();
      await expect(playground.getByRole("heading")).not.toHaveText(previous!);
    }
    await playground
      .getByRole("button", { name: "Recheck", exact: true })
      .click();
    await expect(
      playground.getByRole("link", { name: "Start a fresh camera check-in" }),
    ).toHaveAttribute("href", "/web-check-in");
    await playground
      .getByRole("button", { name: "Support", exact: true })
      .click();
    await expect(playground.getByRole("heading")).toHaveText(
      "Ask someone to check in with you.",
    );
    const examples = playground.getByRole("table", {
      name: "Simulated example metrics — fictional values and history",
    });
    await expect(examples.getByRole("cell")).toHaveCount(14);
    await expect(
      examples.getByRole("cell", { name: "Not available", exact: true }),
    ).toHaveCount(0);
    const details = page
      .locator("details.research-details")
      .filter({ hasText: "Research details and actual camera evidence" });
    await expect(details).not.toHaveAttribute("open");
    await details.locator("summary").click();
    await expect(
      details.getByRole("cell", { name: "Not available", exact: true }),
    ).toHaveCount(14);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await details.locator("summary").click();
    await playground.getByRole("button", { name: "Rest", exact: true }).click();
    await expect(
      playground.getByRole("button", { name: "Rest", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(playground.getByRole("heading")).toHaveText(
      "Take a moment. Request extra rest.",
    );
    await page.screenshot({
      path: test.info().outputPath(`role-play-${width}.png`),
      fullPage: true,
    });
  });
}

test("real research results never acquire random scenario controls", async ({
  page,
}) => {
  const { session, errors } = await fixture(page, "presage", false);
  session.status = "completed";
  await page.goto(`/sessions/${sessionId}`);
  await expect(page.getByText("Model result", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Shuffle demo scenario" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Consider additional rest", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
