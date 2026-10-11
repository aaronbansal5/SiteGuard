import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";

test("worker navigation and direct manager URLs cannot grant manager access", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  await page.goto("/worker");
  await expect(
    page.getByRole("heading", { name: "Take a moment for yourself." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Safety operations" }),
  ).toHaveCount(0);
  await page.goto("/supervisor");
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
  expect((await page.request.get("/api/supervisor/overview")).status()).toBe(
    403,
  );
  expect(
    (await page.request.post("/api/schedule/preview", { data: {} })).status(),
  ).toBe(403);
});

test("manager navigation does not expose worker measurement actions", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", { data: { role: "supervisor" } });
  await page.goto("/supervisor");
  await expect(
    page.getByRole("button", { name: "Preview coverage proposal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Worker portal" }),
  ).toHaveCount(0);
  await page.goto("/check-in");
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
});

test("role survives reload and logout revokes the previous cookie", async ({
  page,
}) => {
  await page.request.post("/api/demo/login", {
    data: { role: "worker", workerId: fixtureId(1) },
  });
  const previous = (await page.context().cookies()).find(
    (c) => c.name === "siteguard",
  )!;
  await page.goto("/history");
  await page.reload();
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/(?:\?next=.*)?$/);
  const replay = await page.request.get("/api/breaks", {
    headers: { cookie: `siteguard=${previous.value}` },
  });
  expect(replay.status()).toBe(401);
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/\?next=/);
});
