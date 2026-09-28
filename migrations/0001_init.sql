-- Migration number: 0001 	 2026-09-28T00:00:00.000Z

-- All timestamps are INTEGER milliseconds since epoch. Booleans are INTEGER 0/1.

CREATE TABLE folders (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id),          -- reparented in code before delete
  name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_folders_owner_parent ON folders(owner, parent_id, sort_order);

CREATE TABLE notes (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  body_plain TEXT NOT NULL DEFAULT '',             -- derived in the Worker on every write
  summary TEXT,                                    -- reserved for LLM summaries
  format TEXT NOT NULL DEFAULT 'inherit' CHECK (format IN ('inherit','formatted','syntax')),
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_owner_order ON notes(owner, pinned DESC, updated_at DESC, id DESC);
CREATE INDEX idx_notes_owner_folder ON notes(owner, folder_id, pinned DESC, updated_at DESC, id DESC);

CREATE TABLE labels (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_labels_owner_name ON labels(owner, name COLLATE NOCASE);

CREATE TABLE note_labels (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, label_id)
);
CREATE INDEX idx_note_labels_label ON note_labels(label_id);

CREATE TABLE images (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  source_url TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_images_owner ON images(owner, created_at DESC);

CREATE TABLE settings (
  owner TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
);
