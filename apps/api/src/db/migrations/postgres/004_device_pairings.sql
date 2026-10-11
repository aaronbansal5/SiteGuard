CREATE TABLE device_pairings (
  token_digest TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX device_pairings_expiry ON device_pairings(expires_at);
