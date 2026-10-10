CREATE TABLE IF NOT EXISTS self_reports (session_id TEXT PRIMARY KEY REFERENCES sessions(id), worker_id TEXT NOT NULL REFERENCES workers(id), payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS self_report_worker ON self_reports(worker_id);
