CREATE TABLE auth_accounts (
 id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL,
 site_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('worker','supervisor')),
 worker_id TEXT REFERENCES workers(id), disabled INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 UNIQUE(issuer, subject), UNIQUE(site_id, worker_id),
 CHECK((role='worker' AND worker_id IS NOT NULL) OR (role='supervisor' AND worker_id IS NULL))
);
CREATE TABLE auth_sessions (
 token_digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES auth_accounts(id),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_account ON auth_sessions(account_id);
CREATE TABLE auth_invitations (
 id TEXT PRIMARY KEY, token_digest TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
 site_id TEXT NOT NULL, worker_id TEXT NOT NULL REFERENCES workers(id),
 created_by TEXT NOT NULL REFERENCES auth_accounts(id), created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, redeemed_at TEXT
);
CREATE TABLE auth_login_transactions (
 token_digest TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL
);

CREATE TABLE auth_demo_sessions (token_digest TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL);

CREATE TABLE auth_deployment_site (id INTEGER PRIMARY KEY CHECK(id=1), site_id TEXT NOT NULL);
