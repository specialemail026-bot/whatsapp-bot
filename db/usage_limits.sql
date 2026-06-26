CREATE TABLE IF NOT EXISTS usage_limits (
  jid TEXT NOT NULL,
  command_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (jid, command_type)
);

CREATE INDEX IF NOT EXISTS usage_limits_updated_at_idx
  ON usage_limits (updated_at);
