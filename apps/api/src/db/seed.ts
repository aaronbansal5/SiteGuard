import { fixtures } from "@siteguard/mock-data";
import { fail } from "../errors.js";
import type { Repository } from "./repository.js";
import { planSchedule } from "../domain/scheduling.js";
export async function seed(r: Repository, reset = false) {
  await r.transaction(async (tx) => {
    if (!reset && (await tx.list("workers")).length) return;
    if (reset) {
      const sessions = await tx.list("sessions");
      if (sessions.some((s) => s.source === "presage"))
        fail(
          409,
          "REAL_DATA_PRESENT",
          "Reset refuses to delete real measurements",
        );
      if (sessions.some((s) => s.status === "active"))
        fail(409, "SESSION_ACTIVE", "Stop active sessions before reset");
      if (
        (await tx.driver.query("SELECT id FROM auth_accounts LIMIT 1")).length
      )
        fail(
          409,
          "ACCOUNTS_PRESENT",
          "Reset refuses to delete a database with authenticated accounts",
        );
      await tx.driver.query("DELETE FROM safety_incidents");
      await tx.driver.query("DELETE FROM safety_events");
      await tx.driver.query("DELETE FROM auth_demo_sessions");
      await tx.driver.query("DELETE FROM auth_login_transactions");
      await tx.driver.query("DELETE FROM self_reports");
      await tx.driver.query("DELETE FROM reading_receipts");
      await tx.driver.query("DELETE FROM vital_readings");
      await tx.clear("symptom_reports");
      await tx.clear("audit_events");
      await tx.clear("task_assignments");
      await tx.clear("worker_availability");
      await tx.driver.query("UPDATE breaks SET request_id=NULL");
      await tx.driver.query("UPDATE rest_requests SET session_id=NULL");
      await tx.clear("rest_requests");
      await tx.clear("sessions");
      await tx.clear("breaks");
      await tx.clear("tasks");
      await tx.clear("workers");
      await tx.driver.query(
        "UPDATE schedule_state SET revision=revision+1 WHERE id=1",
      );
    }
    const f = fixtures();
    for (const x of f.workers) await tx.put("workers", x);
    for (const x of f.breaks) await tx.put("breaks", x);
    for (const x of f.tasks) await tx.put("tasks", x);
    for (const x of f.availability) await tx.put("worker_availability", x);
    for (const x of f.sessions) await tx.put("sessions", x);
    for (const x of f.readings) await tx.insertReading(x.sessionId, x.envelope);
    for (const x of f.selfReports) await tx.putSelfReport(x);
    const p = planSchedule(await tx.schedule());
    for (const x of p.assignments) await tx.put("task_assignments", x);
  });
}
