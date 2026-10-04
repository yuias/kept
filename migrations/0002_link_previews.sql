-- Migration number: 0002 	 2026-10-04T00:00:00.000Z

-- Cache of fetched link-card metadata. Rows are per owner so one user's
-- lookups are not observable by another; expired rows are purged by the cron.

CREATE TABLE link_previews (
  owner TEXT NOT NULL, url TEXT NOT NULL,
  data TEXT NOT NULL,                              -- JSON LinkPreview
  fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner, url)
);
CREATE INDEX idx_link_previews_expires ON link_previews(expires_at);
