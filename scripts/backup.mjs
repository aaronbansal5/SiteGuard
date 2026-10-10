import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export async function backupSqlite(sourcePath, destinationPath) {
  const source = resolve(sourcePath),
    destination = resolve(destinationPath);
  if (!existsSync(source))
    throw new Error("Source SQLite database does not exist");
  if (source === destination || existsSync(destination))
    throw new Error(
      "Choose a new backup path; existing files will not be overwritten",
    );
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
  chmodSync(destination, 0o600);
  const restored = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = restored.prepare("PRAGMA integrity_check").get();
    if (!integrity || Object.values(integrity)[0] !== "ok")
      throw new Error("Backup integrity verification failed");
    const violations = restored.prepare("PRAGMA foreign_key_check").all();
    if (violations.length)
      throw new Error("Backup contains foreign-key violations");
  } finally {
    restored.close();
  }
  return destination;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.env.DATABASE_URL)
    throw new Error(
      "Use provider-managed PostgreSQL backup and restore procedures; this command is SQLite-only",
    );
  const source = process.env.SQLITE_PATH || ".data/siteguard.sqlite";
  const destination =
    process.argv[2] ||
    `.data/backups/siteguard-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  const path = await backupSqlite(source, destination);
  console.log("SQLite snapshot created and restore integrity verified:", path);
}
