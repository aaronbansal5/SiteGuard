CREATE TABLE IF NOT EXISTS rest_recommendations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
  worker_id TEXT NOT NULL REFERENCES workers(id),
  payload TEXT NOT NULL
);
