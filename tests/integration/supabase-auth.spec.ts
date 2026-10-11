import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
import type { Identity } from "@siteguard/contracts";
async function setup(page: import("@playwright/test").Page) {
  let identity: Identity | null = null;
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { mode: "supabase", loginAvailable: true, siteId: "test" },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        identity,
        mode: "supabase",
        account: identity
          ? { id: fixtureId(999), email: "fixture@example.com", siteId: "test" }
          : undefined,
      },
    }),
  );
  await page.route("**/api/auth/password/login", async (route) => {
    const input = route.request().postDataJSON();
    if (input.password === "incorrect-password")
      return route.fulfill({
        status: 401,
        json: {
          error: {
            code: "LOGIN_FAILED",
            message: "Email or password is incorrect.",
          },
        },
      });
    identity =
      input.email === "admin@example.com"
        ? { role: "supervisor" }
        : { role: "worker", workerId: fixtureId(1) };
    await page.request.post("/api/demo/login", { data: identity });
    return route.fulfill({ json: { signedIn: true, identity } });
  });
  await page.route("**/api/auth/logout", async (route) => {
    identity = null;
    await route.fulfill({ json: { loggedOut: true } });
  });
  return async (nextIdentity: Identity) => {
    identity = nextIdentity;
    await page.request.post("/api/demo/login", { data: identity });
  };
}
test("login is the entry screen; worker login restores correct workspace and signs out", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("worker@example.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/worker$/);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Safety operations" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Phone check-in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Web check-in" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/worker$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});
test("admin account lands in manager dashboard and failed login never grants a role", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/supervisor");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email address").fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Email or password is incorrect.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/supervisor$/);
  await expect(
    page.getByRole("heading", { name: "Protected break schedule" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Arrange task coverage" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan coverage" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Break & assistance requests" }),
  ).toBeVisible();
});
test("signup requires matching passwords and displays email confirmation without access", async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  await page.route("**/api/auth/password/signup", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({
      email: "worker@example.com",
      password: "fixture-password",
      displayName: "Jordan",
    });
    await route.fulfill({
      json: {
        signedIn: false,
        message:
          "Check your email to confirm your account, then come back to sign in.",
      },
    });
  });
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Jordan");
  await page.getByLabel("Email address").fill("worker@example.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("The passwords do not match.", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel("Confirm password").fill("fixture-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page).toHaveURL(/\/signup$/);
});
test("password reset opens safely and uses recovery tokens only for password update", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/auth/password/reset", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      password: "new-fixture-password",
    });
    await route.fulfill({
      json: { message: "Password updated. Sign in with your new password." },
    });
  });
  await page.goto(
    "/login?recovery=1#type=recovery&access_token=fixture-access&refresh_token=fixture-refresh",
  );
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-fixture-password");
  await page.getByLabel("Confirm password").fill("new-fixture-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Password updated");
});

test("phone signup without email confirmation returns to mobile check-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const establish = await setup(page);
  await page.route("**/api/auth/password/signup", async (route) => {
    const identity: Identity = { role: "worker", workerId: fixtureId(1) };
    await establish(identity);
    await route.fulfill({ json: { signedIn: true, identity } });
  });
  await page.goto("/mobile");
  await expect(page).toHaveURL(/\/login\?next=%2Fmobile$/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fmobile$/);
  await page.getByLabel("Full name").fill("New worker");
  await page.getByLabel("Email address").fill("new-worker@gmail.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByLabel("Confirm password").fill("fixture-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/mobile$/);
  await expect(
    page.getByRole("link", { name: "Worker portal", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
