import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { backupSqlite } from "./backup.mjs";
const dir = mkdtempSync(join(tmpdir(), "siteguard-backup-"));
try {
  const source = join(dir, "source.sqlite"),
    snapshot = join(dir, "snapshot.sqlite");
  const db = new DatabaseSync(source);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE measurements(id TEXT PRIMARY KEY,source TEXT,quality TEXT);",
  );
  db.prepare("INSERT INTO measurements VALUES(?,?,?)").run(
    "reading-1",
    "mock",
    "valid",
  );
  await backupSqlite(source, snapshot);
  // Keep the source open and then alter it: verify snapshot isolation and WAL capture.
  db.prepare("INSERT INTO measurements VALUES(?,?,?)").run(
    "reading-2",
    "mock",
    "invalid",
  );
  const restored = new DatabaseSync(snapshot, { readOnly: true });
  assert.equal(
    restored.prepare("SELECT count(*) AS n FROM measurements").get().n,
    1,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM measurements").get().n, 2);
  assert.equal(
    restored.prepare("SELECT source FROM measurements").get().source,
    "mock",
  );
  restored.close();
  db.close();
  assert.equal(statSync(snapshot).mode & 0o777, 0o600);
  await assert.rejects(() => backupSqlite(source, snapshot), /existing files/);
  console.log(
    "Backup restore check passed: WAL snapshot, integrity, isolation, restricted file permissions, no overwrite.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
