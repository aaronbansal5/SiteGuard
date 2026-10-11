// Headless rehearsal of docs/PRESENTATION_SCRIPT.md (core synthetic path plus
// the standalone fall-detection segment). Drives the production build in
// Chromium at real cadence (the 60-second synthetic check-in is NOT
// accelerated), saves a screenshot per beat and writes a timing table.
//
//   npm run demo:rehearse                       # builds, own API + SQLite
//   npm run demo:rehearse -- --no-build --out docs/demo-screenshots
//   npm run demo:rehearse -- --base-url http://127.0.0.1:3611   # existing API
//
// Options: --port (default 3622), --fall-port (default 4362), --out
// (default .data/rehearsal/<timestamp>), --skip-fall, --no-build, --headed,
// --chromium <path> (or DEMO_CHROMIUM_PATH). Without --base-url it uses its
// own database file .data/rehearsal.sqlite, deleted at start, so it never
// touches the presentation database. Fictional data only.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string" },
    port: { type: "string", default: "3622" },
    "fall-port": { type: "string", default: "4362" },
    out: { type: "string" },
    "skip-fall": { type: "boolean", default: false },
    "no-build": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    chromium: { type: "string" },
  },
});

const root = resolve(import.meta.dirname, "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(root, args.out ?? join(".data", "rehearsal", stamp));
mkdirSync(out, { recursive: true });
const ownServer = !args["base-url"];
const base = args["base-url"] ?? `http://127.0.0.1:${args.port}`;
const fallPort = Number(args["fall-port"]);
const children: ChildProcess[] = [];

interface Beat {
  id: string;
  title: string;
  window: string;
  targetSeconds: number;
  seconds?: number;
  status: "pass" | "fail" | "skipped";
  checks: string[];
  screenshots: string[];
  error?: string;
}
const beats: Beat[] = [];
const BANNED =
  /diagnos|recovered|safe to return|fatigue score|optimal break|predict/i;

async function beat(
  id: string,
  title: string,
  window: string,
  targetSeconds: number,
  run: (b: Beat) => Promise<void>,
) {
  const b: Beat = {
    id,
    title,
    window,
    targetSeconds,
    status: "pass",
    checks: [],
    screenshots: [],
  };
  beats.push(b);
  const started = performance.now();
  process.stdout.write(`▶ ${id} ${title} … `);
  try {
    await run(b);
  } catch (e) {
    b.status = "fail";
    b.error = (e as Error).message.split("\n")[0];
  }
  b.seconds = (performance.now() - started) / 1000;
  console.log(
    `${b.status.toUpperCase()} ${b.seconds.toFixed(1)} s (target ${targetSeconds ? `${targetSeconds} s` : "none"})${b.error ? ` · ${b.error}` : ""}`,
  );
  return b.status === "pass";
}

function check(b: Beat, ok: unknown, label: string) {
  if (!ok) throw new Error(`Check failed: ${label}`);
  b.checks.push(label);
}

async function shot(page: Page, b: Beat, name: string, focus?: Locator) {
  if (focus) {
    await focus.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -24));
  }
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  b.screenshots.push(file);
}

async function noBannedWords(page: Page, b: Beat, where: string) {
  const text = await page.locator("main").innerText();
  const hit = BANNED.exec(text);
  check(b, !hit, `no banned wording on ${where}${hit ? ` (${hit[0]})` : ""}`);
}

async function until<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs: number,
  label: string,
) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await read().catch(() => undefined as T);
    if (v !== undefined && ok(v)) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startProcess(cmd: string, argv: string[], cwd: string, env = {}) {
  const child = spawn(cmd, argv, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  child.on("exit", (code) => {
    if (code && !stopping) console.error(`${cmd} exited ${code}\n${log}`);
  });
  children.push(child);
  return child;
}
let stopping = false;
function stopAll() {
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

async function main() {
  if (ownServer) {
    if (!args["no-build"]) {
      const build = spawnSync("npm", ["run", "build"], {
        cwd: root,
        stdio: "inherit",
      });
      if (build.status !== 0) throw new Error("npm run build failed");
    }
    if (!existsSync(join(root, "apps/api/dist/server.js")))
      throw new Error("No production build. Run npm run build first.");
    const db = join(root, ".data", "rehearsal.sqlite");
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(db + suffix, { force: true });
    startProcess("node", ["apps/api/dist/server.js"], root, {
      PORT: args.port,
      HOST: "127.0.0.1",
      SQLITE_PATH: db,
      DATABASE_URL: "",
      DEMO_MODE: "true",
      HOSTED: "false",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "",
      PRESAGE_BRIDGE_TOKEN: "",
      COOKIE_SECRET: randomBytes(32).toString("hex"),
      MEASUREMENT_TOKEN: randomBytes(16).toString("hex"),
    });
  }
  await until(
    () => fetch(`${base}/api/health`).then((r) => r.json()),
    (h: { status?: string }) => h.status === "ok",
    20000,
    `${base}/api/health`,
  );

  const browser: Browser = await chromium.launch({
    headless: !args.headed,
    executablePath: args.chromium ?? process.env.DEMO_CHROMIUM_PATH,
  });
  const viewport = { width: 1366, height: 860 };
  const worker = await (
    await browser.newContext({ baseURL: base, viewport })
  ).newPage();
  const supervisorContext = await browser.newContext({
    baseURL: base,
    viewport,
  });
  const supervisor = await supervisorContext.newPage();
  for (const p of [worker, supervisor]) p.setDefaultTimeout(15000);
  // Fresh fictional schedule: W-01's protected break started 2 minutes ago.
  await supervisor.request.post("/api/demo/login", {
    data: { role: "supervisor" },
  });
  const reset = await supervisor.request.post("/api/demo/reset", { data: {} });
  if (!reset.ok()) throw new Error(`Demo reset failed: ${await reset.text()}`);
  type BreakRow = {
    id: string;
    workerId: string;
    kind: string;
    startsAt: string;
    endsAt: string;
  };
  const protectedBreaks = async () =>
    (
      (await (await supervisor.request.get("/api/breaks")).json()) as {
        breaks: BreakRow[];
      }
    ).breaks
      .filter((b) => b.kind === "protected")
      .sort((a, b) => a.id.localeCompare(b.id));
  const before = JSON.stringify(await protectedBreaks());
  let sessionId = "";
  let workerId = "";
  const runStart = performance.now();

  await beat("B1", "Problem (landing page)", "0:00–0:20", 20, async (b) => {
    await worker.goto("/");
    await worker
      .getByRole("heading", { name: "A better view of the break." })
      .waitFor();
    check(
      b,
      await worker.getByText("Local demonstration").isVisible(),
      "landing shows 'Local demonstration' badge",
    );
    await noBannedWords(worker, b, "landing");
    await shot(worker, b, "01-landing");
  });

  await beat(
    "B2",
    "Protected schedule + Integrations (supervisor)",
    "0:20–0:35",
    15,
    async (b) => {
      await supervisor.goto("/");
      await supervisor
        .getByRole("button", { name: "Open safety operations" })
        .click();
      await supervisor
        .getByRole("heading", { name: "Protected break schedule" })
        .waitFor();
      const panel = supervisor.getByRole("region", { name: "Integrations" });
      await panel.getByText("Database").waitFor();
      const integrations = (await panel.innerText()).replace(/\s+/g, " ");
      check(b, /Database/.test(integrations), "Integrations panel visible");
      b.checks.push(`Integrations: ${integrations.trim()}`);
      check(
        b,
        (await supervisor.locator(".timeline-row").count()) === 6,
        "six fictional workers on the timeline",
      );
      check(
        b,
        (await supervisor.locator(".break-bar.protected").count()) === 6,
        "six protected 15-minute breaks shown",
      );
      await shot(supervisor, b, "02-supervisor-schedule");
    },
  );

  await beat("B3", "Consent (worker W-01)", "0:35–0:55", 20, async (b) => {
    await worker.getByLabel("Demo worker").selectOption({
      label: "Worker W-01",
    });
    await worker.getByRole("button", { name: "Open worker portal" }).click();
    await worker
      .getByRole("link", { name: "Start voluntary check-in" })
      .click();
    await worker
      .getByRole("heading", { name: "A check-in on your terms." })
      .waitFor();
    check(
      b,
      !(await worker
        .getByLabel("Share this session's summary with safety operations")
        .isChecked()),
      "sharing with supervisor is off by default",
    );
    check(
      b,
      (await worker.getByLabel("Measurement source").inputValue()) === "mock",
      "synthetic source selected",
    );
    await worker.getByLabel("I understand the limitations").check();
    await shot(worker, b, "03-consent");
    await worker.getByRole("button", { name: "Begin check-in" }).click();
    await worker
      .getByRole("heading", { name: "Settle in. Observe the change." })
      .waitFor();
    sessionId = /sessions\/([^/]+)\/measure/.exec(worker.url())![1];
  });

  const readings = async () => {
    const r = await worker.request.get(`/api/sessions/${sessionId}/readings`);
    return r.ok()
      ? ((await r.json()) as { readings: unknown[] }).readings.length
      : 0;
  };
  await beat(
    "B4",
    "Measurement (60 s real time, not accelerated)",
    "0:55–1:55",
    60,
    async (b) => {
      check(
        b,
        await worker.getByText("Synthetic demo", { exact: true }).isVisible(),
        "'Synthetic demo' badge",
      );
      check(
        b,
        await worker
          .getByText("No camera required", { exact: true })
          .isVisible(),
        "'No camera required'",
      );
      await until(readings, (n) => n >= 28, 45000, "28 readings");
      await worker.waitForTimeout(1200);
      await shot(
        worker,
        b,
        "04a-measurement-gap",
        worker.locator(".chart-card").first(),
      );
      await until(readings, (n) => n >= 60, 45000, "60 readings");
      await worker.waitForTimeout(1200);
      await worker.evaluate(() => window.scrollTo(0, 0));
      await shot(worker, b, "04b-measurement-60s");
      check(b, (await readings()) >= 60, "≥ 60 one-second readings stored");
      const all = (await (
        await worker.request.get(`/api/sessions/${sessionId}/readings`)
      ).json()) as {
        readings: { sequence: number; reading: { quality: string } }[];
      };
      const invalid = all.readings
        .filter((r) => r.reading.quality !== "valid")
        .map((r) => r.sequence);
      check(
        b,
        invalid.join(",") === "20,21,22,23,24",
        `invalid segment is readings ${invalid.join(",")} (shown as a gap)`,
      );
      await worker.getByRole("button", { name: "Finish check-in" }).click();
    },
  );

  await beat(
    "B5",
    "Summary + worker-only personal comparison + tiredness rating",
    "1:55–2:30",
    35,
    async (b) => {
      await worker
        .getByRole("heading", { name: "Your observations, in context." })
        .waitFor();
      check(
        b,
        (await worker.getByText("Observed change", { exact: true }).count()) ===
          2,
        "pulse and breathing show 'Observed change'",
      );
      check(
        b,
        (await worker
          .getByText("4 matching prior sessions", { exact: false })
          .count()) === 2,
        "comparison uses 4 matching synthetic prior sessions",
      );
      await worker.locator(".explanation .fact").first().waitFor();
      check(
        b,
        await worker.getByText("Deterministic explanation").isVisible(),
        "explanation labeled deterministic",
      );
      check(
        b,
        await worker
          .getByText(/private to your worker workspace\. Heavy workload/)
          .isVisible(),
        "context line reads 'Heavy workload · 26°C'",
      );
      await noBannedWords(worker, b, "summary");
      await shot(worker, b, "05a-summary");
      const panel = worker.locator("section.card.personal");
      await panel
        .getByRole("heading", { name: "Compared with your own usual" })
        .waitFor();
      await panel.getByText("Experimental", { exact: true }).waitFor();
      check(
        b,
        await panel.getByText(/synthetic demo data/).isVisible(),
        "personal panel labeled experimental + synthetic demo data",
      );
      const rating = panel.getByRole("group", {
        name: /Tiredness self-report/,
      });
      await rating.getByRole("radio", { name: /^3/ }).check();
      await panel.getByRole("status").getByText("Rating saved.").waitFor();
      await shot(worker, b, "05b-personal-panel", panel);
      await panel.getByRole("button", { name: "Clear my rating" }).click();
      await panel.getByRole("status").getByText("Rating removed.").waitFor();
      check(b, true, "rating saved, then removed by the worker");
      const hidden = await supervisor.request.get(
        `/api/sessions/${sessionId}/personal-insights`,
      );
      check(
        b,
        hidden.status() === 403,
        "supervisor gets 403 for personal insights",
      );
      const me = (await (await worker.request.get("/api/demo/me")).json()) as {
        workerId: string;
      };
      workerId = me.workerId;
    },
  );

  let approvedStart = "";
  await beat("B6", "Request and approval", "2:30–2:55", 25, async (b) => {
    await worker
      .getByRole("button", { name: "Request additional rest" })
      .click();
    await worker.getByLabel("Additional minutes").fill("5");
    await worker
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await worker
      .getByText("Additional rest requested.", { exact: false })
      .waitFor();
    const card = supervisor.locator("article.request", {
      has: supervisor.getByRole("heading", {
        name: "5 minutes additional rest",
      }),
    });
    await card.waitFor({ timeout: 10000 });
    await card
      .getByRole("button", { name: "Approve rest", exact: true })
      .click();
    const dialog = supervisor.getByRole("dialog");
    await dialog.waitFor();
    await shot(supervisor, b, "06a-approve-dialog");
    await dialog.getByRole("button", { name: "Confirm approve" }).click();
    await card.getByText("Approved rest:", { exact: false }).waitFor();
    const overview = (await (
      await supervisor.request.get("/api/supervisor/overview")
    ).json()) as {
      requests: {
        kind: string;
        workerId: string;
        status: string;
        restStartsAt: string | null;
      }[];
    };
    const rest = overview.requests.find((r) => r.kind === "additional_rest")!;
    const own = (
      (await (await worker.request.get("/api/breaks")).json()) as {
        breaks: BreakRow[];
      }
    ).breaks.find((x) => x.kind === "protected")!;
    approvedStart = rest.restStartsAt!;
    check(b, rest.status === "approved", "request approved");
    check(
      b,
      Date.parse(rest.restStartsAt!) >= Date.parse(own.endsAt),
      `approved rest starts after the protected break (${rest.restStartsAt} ≥ ${own.endsAt})`,
    );
    await shot(supervisor, b, "06b-approved", card);
  });

  await beat(
    "B7",
    "Coverage preview and commit",
    "2:55–3:15",
    20,
    async (b) => {
      await supervisor
        .getByRole("button", { name: "Preview coverage proposal" })
        .click();
      await supervisor.getByText("Proposal ready").waitFor();
      await shot(
        supervisor,
        b,
        "07a-proposal",
        supervisor.getByRole("heading", { name: "Coverage coordination" }),
      );
      await supervisor
        .getByRole("button", { name: "Commit coverage proposal" })
        .click();
      await supervisor
        .getByText("Coverage updated. Protected breaks preserved.")
        .waitFor();
      const why = supervisor.locator("section.explanation", {
        has: supervisor.getByRole("heading", { name: "Why coverage changed" }),
      });
      await why.waitFor();
      check(
        b,
        await why.getByText("Deterministic explanation").isVisible(),
        "coverage explanation labeled 'Deterministic explanation'",
      );
      check(
        b,
        JSON.stringify(await protectedBreaks()) === before,
        "protected breaks unchanged after commit",
      );
      await shot(
        supervisor,
        b,
        "07b-committed",
        supervisor.getByRole("heading", { name: "Coverage coordination" }),
      );
    },
  );

  await beat("B8", "Human assistance", "3:15–3:35", 20, async (b) => {
    await worker.getByRole("button", { name: "Report a symptom" }).click();
    await worker
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await worker
      .getByText("Symptom report and assistance request saved.", {
        exact: false,
      })
      .waitFor();
    const card = supervisor.locator("article.request", {
      has: supervisor.getByRole("heading", {
        name: "Human assistance requested",
      }),
    });
    await card.waitFor({ timeout: 10000 });
    await card
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await supervisor
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm acknowledge" })
      .click();
    await card.getByText("acknowledged", { exact: true }).waitFor();
    check(
      b,
      await card.getByText("Reported: Feeling dizzy").isVisible(),
      "supervisor sees the symptom label 'Feeling dizzy'",
    );
    await supervisor
      .getByRole("button", { name: "Preview coverage proposal" })
      .click();
    await supervisor.getByText("Proposal ready").waitFor();
    await supervisor
      .getByRole("button", { name: "Commit coverage proposal" })
      .click();
    await supervisor
      .getByText("Coverage updated. Protected breaks preserved.")
      .waitFor();
    const overview = (await (
      await supervisor.request.get("/api/supervisor/overview")
    ).json()) as {
      requests: { kind: string; status: string }[];
      assignments: { workerId: string; endsAt: string }[];
    };
    check(
      b,
      overview.requests.find((r) => r.kind === "assistance")?.status ===
        "acknowledged",
      "assistance still unresolved (acknowledged) after commit",
    );
    check(
      b,
      !overview.assignments.some(
        (a) => a.workerId === workerId && Date.parse(a.endsAt) > Date.now(),
      ),
      "worker has no current or future task assignment",
    );
    check(
      b,
      JSON.stringify(await protectedBreaks()) === before,
      "protected breaks still unchanged",
    );
    await shot(supervisor, b, "08-assistance", card);
  });

  await beat("B9", "Close", "3:35–3:45", 10, async (b) => {
    await supervisor.evaluate(() => window.scrollTo(0, 0));
    await supervisor
      .locator(".timeline-card")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    check(
      b,
      (await supervisor.locator(".break-bar.additional").count()) === 1,
      `approved additional rest drawn on the timeline (${approvedStart})`,
    );
    await noBannedWords(supervisor, b, "supervisor view");
    check(
      b,
      !/Compared with your own usual|How tired do you feel/.test(
        await supervisor.locator("body").innerText(),
      ),
      "supervisor view shows no personal panel or rating",
    );
    await shot(supervisor, b, "09-close-timeline");
  });
  const coreSeconds = (performance.now() - runStart) / 1000;

  await beat(
    "X1",
    "Worker history (DEMO.md step 7; not in the spoken script)",
    "—",
    0,
    async (b) => {
      await worker.goto("/history");
      await worker
        .getByRole("heading", { name: "Your recent sessions" })
        .waitFor();
      await worker.getByText(/^Your recent sessions show your pulse/).waitFor();
      check(b, true, "personal trend shown for synthetic sessions");
      await shot(worker, b, "10-history");
    },
  );

  if (args["skip-fall"]) {
    beats.push({
      id: "F1",
      title: "Fall detection (standalone, synthetic)",
      window: "optional",
      targetSeconds: 30,
      status: "skipped",
      checks: [],
      screenshots: [],
    });
  } else {
    const fallDb = join(root, ".data", "rehearsal-incidents.sqlite");
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(fallDb + suffix, { force: true });
    startProcess(
      "python3",
      [
        "-m",
        "fall_detection.server",
        "--port",
        String(fallPort),
        "--database",
        fallDb,
      ],
      join(root, "integrations/fall-detection"),
    );
    const fallBase = `http://127.0.0.1:${fallPort}`;
    type FallState = {
      source: string;
      incidents: { id: string; status: string }[];
    };
    const state = () =>
      fetch(`${fallBase}/api/state`).then(
        (r) => r.json() as Promise<FallState>,
      );
    await until(state, (s) => s.source === "synthetic", 15000, fallBase);
    const fall = await (await browser.newContext({ viewport })).newPage();
    fall.setDefaultTimeout(15000);
    await beat(
      "F1",
      "Fall detection (standalone, synthetic)",
      "optional",
      30,
      async (b) => {
        await fall.goto(fallBase + "/");
        await fall
          .getByRole("heading", { name: "Possible person down" })
          .waitFor();
        await fall
          .locator("#source")
          .getByText(/synthetic/i)
          .waitFor();
        check(
          b,
          await fall.locator("#camera-banner").isHidden(),
          "no 'Camera active' banner in synthetic mode",
        );
        await fall.getByRole("button", { name: "Standing upright" }).click();
        await fall.waitForTimeout(1000);
        await fall.getByRole("button", { name: "Horizontal pose" }).click();
        const incident = fall.locator("#incidents article.incident");
        await incident.first().waitFor({ timeout: 10000 });
        await fall.waitForTimeout(3000);
        const s = await state();
        check(b, s.incidents.length === 1, "exactly one incident raised");
        await shot(fall, b, "11a-fall-incident");
        await incident.getByRole("button", { name: "Acknowledge" }).click();
        await incident.getByText("acknowledged").waitFor();
        await incident
          .getByRole("button", { name: "Resolve after check" })
          .click();
        await fall
          .getByText("Add a follow-up note before closing this observation.")
          .waitFor();
        check(b, true, "resolve without a note is refused");
        await incident
          .getByLabel("Follow-up note (required to close)")
          .fill("Checked in person; rehearsal only, synthetic scenario.");
        await incident
          .getByRole("button", { name: "Resolve after check" })
          .click();
        await incident.getByText("Recorded note:", { exact: false }).waitFor();
        check(
          b,
          (await state()).incidents[0]?.status === "resolved",
          "incident resolved with a note",
        );
        await fall.getByRole("button", { name: "Standing upright" }).click();
        await fall.waitForTimeout(1500);
        await fall.getByRole("button", { name: "Brief bend" }).click();
        await fall.waitForTimeout(3000);
        check(
          b,
          (await state()).incidents.length === 1,
          "brief bend raises no new incident",
        );
        await shot(fall, b, "11b-fall-resolved");
      },
    );
  }
  await browser.close();
  return coreSeconds;
}

function report(coreSeconds: number) {
  const rel = (f: string) => relative(out, f);
  const rows = beats.map(
    (b) =>
      `| ${b.id} | ${b.title} | ${b.window} | ${b.targetSeconds || "—"} | ${b.seconds?.toFixed(1) ?? "—"} | ${b.status.toUpperCase()} | ${b.screenshots.map((s) => `[${rel(s)}](${rel(s)})`).join(" ")} |`,
  );
  const md = [
    `# Demo rehearsal ${new Date().toISOString()}`,
    "",
    `Target: ${base}. "Automation" is click-and-wait time only; the rest of each target is talk time.`,
    `Core path (B1–B9) automation total: ${coreSeconds.toFixed(1)} s against a 225 s spoken target.`,
    "",
    "| Beat | Title | Script window | Target s | Automation s | Result | Screenshots |",
    "| ---- | ----- | ------------- | -------- | ------------ | ------ | ----------- |",
    ...rows,
    "",
    "## Checks",
    "",
    ...beats.flatMap((b) => [
      `### ${b.id} ${b.title}`,
      "",
      ...b.checks.map((c) => `- ${c}`),
      ...(b.error ? [`- **FAILED:** ${b.error}`] : []),
      "",
    ]),
  ].join("\n");
  writeFileSync(join(out, "timings.md"), md);
  writeFileSync(
    join(out, "timings.json"),
    JSON.stringify(
      {
        base,
        coreSeconds,
        beats: beats.map((b) => ({
          ...b,
          screenshots: b.screenshots.map(rel),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nTiming table: ${join(out, "timings.md")}`);
  console.log(`Core path automation total: ${coreSeconds.toFixed(1)} s`);
}

let failed = true;
try {
  const coreSeconds = await main();
  report(coreSeconds);
  failed = beats.some((b) => b.status === "fail");
} catch (e) {
  console.error((e as Error).message);
  report(0);
} finally {
  stopAll();
}
process.exit(failed ? 1 : 0);
