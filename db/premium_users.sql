CREATE TABLE IF NOT EXISTS premium_users (
  jid TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS premium_users_expires_at_idx
  ON premium_users (expires_at);
