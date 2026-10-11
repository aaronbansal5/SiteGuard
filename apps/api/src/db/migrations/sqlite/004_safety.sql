CREATE TABLE IF NOT EXISTS safety_events (
 id TEXT PRIMARY KEY,
 camera_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 sequence INTEGER NOT NULL,
 digest TEXT NOT NULL,
 payload TEXT NOT NULL,
 UNIQUE(camera_id,run_id,sequence)
);
CREATE TABLE IF NOT EXISTS safety_incidents (
 id TEXT PRIMARY KEY REFERENCES safety_events(id),
 worker_id TEXT REFERENCES workers(id),
 assistance_request_id TEXT REFERENCES rest_requests(id),
 received_at TEXT NOT NULL,
 payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS safety_incident_time ON safety_incidents(received_at);
