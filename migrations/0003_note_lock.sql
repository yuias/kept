-- Migration number: 0003 	 2026-10-05T00:00:00.000Z

-- A UI-level guard against accidental edits; the API does not enforce it.
ALTER TABLE notes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
