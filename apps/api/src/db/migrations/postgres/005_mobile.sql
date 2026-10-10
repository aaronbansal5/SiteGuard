CREATE TABLE auth_mobile_codes (token_digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES auth_accounts(id), challenge TEXT NOT NULL, expires_at TEXT NOT NULL);
