-- Iris MCP - Notification Queue Schema

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  from_team TEXT,
  to_team TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'read', 'expired')),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_team ON notifications(to_team);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);
