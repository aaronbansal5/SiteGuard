/**
 * Opt-in debug tool: which SmartSpectra metric fields does the real SDK
 * populate, and when do they first become `stable`?
 *
 *   SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --file clip.mp4
 *   SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --camera --max-seconds 90
 *
 * Flags: --file <path> | --camera (default), --max-seconds N (default 90),
 *        --interframe-ms N (file mode, default 33 ~ real time; 0 = fastest),
 *        --all (also face/eda/micromotion), --verbose (every packet),
 *        --strict (ONLY PULSE_RATE_STRICT + BREATHING_RATE_STRICT; the SDK
 *        rejects sessions that mix strict and standard metrics).
 *
 * Prints field presence, sample counts, stable counts and confidence only.
 * Never prints or writes metric values, frames or footage. Telemetry is off.
 * Requires network access (the SDK validates the key) and may consume
 * subscription usage.
 */
import {
  parseInspectArgs,
  runInspect,
  type InspectModule,
} from "../src/inspect.js";

const parsed = parseInspectArgs(process.argv.slice(2));
if (typeof parsed === "string") {
  console.error(`inspect:metrics: ${parsed}`);
  process.exit(2);
}
const code = await runInspect(parsed, {
  env: process.env,
  load: async () =>
    (await import("@smartspectra/node-sdk")) as unknown as InspectModule,
  log: (l) => console.log(l),
  nowMs: () => performance.now(),
});
process.exit(code);
