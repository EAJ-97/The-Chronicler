/**
 * database.js — SQLite initialisation and versioned schema migrations.
 *
 * How it works:
 *   1. Core tables are created via CREATE TABLE IF NOT EXISTS using the full
 *      current schema. Fresh installs get all columns at once with no ALTER needed.
 *   2. schema_migrations tracks every migration that has run by name.
 *   3. migrate(name, fn) runs fn() exactly once inside a transaction, then records
 *      the name so the migration is permanently skipped on all future boots.
 *   4. ALTER TABLE migrations use try/catch — safe on both fresh installs (column
 *      already exists from CREATE TABLE) and upgrades from older schema versions.
 *   5. Data backfills are guarded by WHERE conditions so they are always idempotent.
 *   6. Roadmap columns/tables are pre-scaffolded at the bottom so future features
 *      slot in without touching the core schema block.
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_DIR = process.env.DB_DIR || '/data';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'dnd_notes.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migration tracker ────────────────────────────────────────────────────────
// Created before any migrate() call so the table always exists.
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT UNIQUE NOT NULL,
    run_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * Runs a named migration exactly once per database lifetime.
 * fn() executes inside a transaction; on success the name is inserted into
 * schema_migrations so the migration is never repeated on future boots.
 * @param {string}   name - Unique migration identifier, e.g. '001_notes_parent_id'
 * @param {Function} fn   - Migration body; may contain DDL, DML, or both
 */
function migrate(name, fn) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) return;
  db.transaction(() => {
    fn();
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  })();
}

// ─── Core tables ──────────────────────────────────────────────────────────────
// Full schema for clean installs. Every column that has ever been added via a
// migration is included here so new deployments never need ALTER TABLE at all.
// Existing deployments rely on the migrate() calls below to fill in any gaps.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash         TEXT NOT NULL,
    is_admin              INTEGER DEFAULT 0,
    is_demo               INTEGER DEFAULT 0,
    force_password_change INTEGER DEFAULT 0,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_open', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('demo_seeded',       'false');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_enabled',        'false');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_api_key',        '');

  CREATE TABLE IF NOT EXISTS notes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER  NOT NULL,
    parent_id          INTEGER  DEFAULT NULL,
    title              TEXT     NOT NULL,
    content            TEXT     DEFAULT '',
    is_shared          INTEGER  DEFAULT 0,
    is_folder          INTEGER  DEFAULT 0,
    category           TEXT     DEFAULT 'general',
    color              TEXT     DEFAULT '',
    sort_order         INTEGER  DEFAULT 0,
    visibility         TEXT     DEFAULT 'private',
    significance       TEXT     DEFAULT 'standard',
    narrative_weight   TEXT     DEFAULT 'node',
    deleted_at         DATETIME DEFAULT NULL,
    original_parent_id INTEGER  DEFAULT NULL,
    recovered          INTEGER  DEFAULT 0,
    is_dm_only         INTEGER  DEFAULT 0,
    is_demo            INTEGER  DEFAULT 0,
    status             TEXT     DEFAULT NULL,
    is_world           INTEGER  DEFAULT 0,
    source_note_id     INTEGER  DEFAULT NULL,
    display_icon       TEXT     DEFAULT NULL,
    display_summary    TEXT     DEFAULT NULL,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS note_permissions (
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (note_id, user_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS connections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id INTEGER NOT NULL,
    target_note_id INTEGER NOT NULL,
    label          TEXT    DEFAULT '',
    is_speculative INTEGER DEFAULT 0,
    created_by     INTEGER NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by)     REFERENCES users(id),
    UNIQUE(source_note_id, target_note_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id      INTEGER DEFAULT NULL,
    title          TEXT    DEFAULT NULL,
    session_number INTEGER DEFAULT NULL,
    is_demo        INTEGER DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    folder_id    INTEGER DEFAULT NULL,
    session_id   INTEGER DEFAULT NULL,
    content      TEXT    NOT NULL DEFAULT '',
    indent_level INTEGER DEFAULT 0,
    sort_order   REAL    DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (folder_id)  REFERENCES notes(id)    ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    tag     TEXT    NOT NULL COLLATE NOCASE,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, tag)
  );

  CREATE TABLE IF NOT EXISTS note_visibility (
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    hidden  INTEGER DEFAULT 0,
    PRIMARY KEY (note_id, user_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS folder_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id     INTEGER NOT NULL,
    saved_by      INTEGER NOT NULL,
    label         TEXT    DEFAULT NULL,
    saved_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    snapshot_json TEXT    NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (saved_by)  REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS note_images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id       INTEGER NOT NULL,
    filename      TEXT    NOT NULL,
    original_name TEXT    NOT NULL,
    uploaded_by   INTEGER NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id)     REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS folder_roles (
    folder_id   INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'dm',
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (folder_id, user_id),
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recaps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL,
    folder_id    INTEGER NOT NULL,
    generated_by INTEGER NOT NULL,
    tone         TEXT    NOT NULL DEFAULT 'chronicle',
    content      TEXT    NOT NULL,
    is_dm_only   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id)   REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id)    REFERENCES notes(id)    ON DELETE CASCADE,
    FOREIGN KEY (generated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS recap_usage (
    session_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    count      INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, user_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
  );

  -- Phase 1 roadmap: tracks player attendance per session (Session Attendance Tracker)
  CREATE TABLE IF NOT EXISTS session_attendance (
    session_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    attended   INTEGER DEFAULT 1,
    PRIMARY KEY (session_id, user_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
  );

  -- Phase 1 roadmap: per-session DM prep checklist items (Session Prep Checklist)
  CREATE TABLE IF NOT EXISTS session_checklist_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    is_checked INTEGER DEFAULT 0,
    sort_order REAL    DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)    ON DELETE CASCADE
  );
`);

// ─── FTS5 virtual table + sync triggers ───────────────────────────────────────
// Full-text search over note title and content, kept in sync via triggers.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, content='notes', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  END;
`);

// Backfill FTS index for any notes not yet indexed (safe to re-run — guarded by count)
try {
  const ftsCount   = db.prepare('SELECT COUNT(*) as c FROM notes_fts').get().c;
  const notesCount = db.prepare('SELECT COUNT(*) as c FROM notes').get().c;
  if (ftsCount < notesCount) {
    db.exec('INSERT INTO notes_fts(rowid, title, content) SELECT id, title, content FROM notes');
  }
} catch {}

// ─── Versioned migrations ─────────────────────────────────────────────────────
// Each migrate() call runs exactly once, tracked in schema_migrations.
// On a fresh install every ALTER TABLE is a silent no-op (column already exists
// from CREATE TABLE above). On an upgrade from an older version the ALTER succeeds
// and the column is added. Either way the migration name is recorded and skipped
// on all future boots.

// — notes: structural columns —
migrate('001_notes_parent_id',    () => { try { db.exec("ALTER TABLE notes ADD COLUMN parent_id INTEGER DEFAULT NULL"); } catch {} });
migrate('002_notes_is_folder',    () => { try { db.exec("ALTER TABLE notes ADD COLUMN is_folder INTEGER DEFAULT 0"); } catch {} });
migrate('003_notes_sort_order',   () => { try { db.exec("ALTER TABLE notes ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {} });
migrate('004_notes_visibility',   () => { try { db.exec("ALTER TABLE notes ADD COLUMN visibility TEXT DEFAULT 'private'"); } catch {} });

// Backfill visibility from the legacy is_shared flag
migrate('005_notes_visibility_backfill', () => {
  db.exec(`
    UPDATE notes SET visibility = 'public'  WHERE is_shared = 1 AND visibility = 'private';
    UPDATE notes SET visibility = 'private' WHERE is_shared = 0 AND visibility = 'public';
  `);
});

// — journal_entries: structural columns —
migrate('006_journal_folder_id',        () => { try { db.exec("ALTER TABLE journal_entries ADD COLUMN folder_id INTEGER DEFAULT NULL"); } catch {} });
migrate('007_journal_is_session_break', () => { try { db.exec("ALTER TABLE journal_entries ADD COLUMN is_session_break INTEGER DEFAULT 0"); } catch {} });
migrate('008_journal_sort_order',       () => { try { db.exec("ALTER TABLE journal_entries ADD COLUMN sort_order REAL DEFAULT 0"); } catch {} });

// Backfill sort_order from row id so existing entries retain their original order
migrate('009_journal_sort_order_backfill', () => {
  db.exec('UPDATE journal_entries SET sort_order = id WHERE sort_order = 0');
});

// — notes: content metadata —
migrate('010_notes_significance',     () => { try { db.exec("ALTER TABLE notes ADD COLUMN significance TEXT DEFAULT 'standard'"); } catch {} });
migrate('011_notes_narrative_weight', () => { try { db.exec("ALTER TABLE notes ADD COLUMN narrative_weight TEXT DEFAULT 'node'"); } catch {} });

// — notes: soft delete —
migrate('012_notes_deleted_at',         () => { try { db.exec("ALTER TABLE notes ADD COLUMN deleted_at DATETIME DEFAULT NULL"); } catch {} });
migrate('013_notes_original_parent_id', () => { try { db.exec("ALTER TABLE notes ADD COLUMN original_parent_id INTEGER DEFAULT NULL"); } catch {} });
migrate('014_notes_recovered',          () => { try { db.exec("ALTER TABLE notes ADD COLUMN recovered INTEGER DEFAULT 0"); } catch {} });
migrate('015_notes_is_dm_only',         () => { try { db.exec("ALTER TABLE notes ADD COLUMN is_dm_only INTEGER DEFAULT 0"); } catch {} });

// — sessions table (was a runtime migration in older versions) —
migrate('016_sessions_table', () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id  INTEGER DEFAULT NULL,
      is_demo    INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE
    );
  `);
});

// — journal_entries: session foreign key —
migrate('017_journal_session_id', () => { try { db.exec("ALTER TABLE journal_entries ADD COLUMN session_id INTEGER DEFAULT NULL"); } catch {} });

/**
 * Backfill sessions from legacy is_session_break markers.
 * Scans each folder's entries in sort_order, creates a session row per break
 * marker, assigns session_id to all following entries, then removes the markers.
 * Guarded by a pre-check so it is a no-op on databases already migrated.
 */
migrate('018_journal_session_backfill', () => {
  let needsBackfill = false;
  try {
    needsBackfill =
      db.prepare("SELECT COUNT(*) as c FROM journal_entries WHERE session_id IS NULL AND is_session_break = 0").get().c > 0 ||
      db.prepare("SELECT COUNT(*) as c FROM journal_entries WHERE is_session_break = 1").get().c > 0;
  } catch {}
  if (!needsBackfill) return;

  const folderIds = db.prepare("SELECT DISTINCT folder_id FROM journal_entries ORDER BY folder_id ASC").all().map(r => r.folder_id);

  for (const folderId of folderIds) {
    const entries = db.prepare(`
      SELECT id, is_session_break, created_at FROM journal_entries
      WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL))
      ORDER BY sort_order ASC, id ASC
    `).all(folderId, folderId);

    if (!entries.length) continue;

    let currentSessionId = null;
    for (const entry of entries) {
      if (entry.is_session_break) {
        const result = db.prepare("INSERT INTO sessions (folder_id, created_at) VALUES (?, ?)").run(folderId, entry.created_at);
        currentSessionId = result.lastInsertRowid;
      } else {
        if (currentSessionId === null) {
          const result = db.prepare("INSERT INTO sessions (folder_id, created_at) VALUES (?, ?)").run(folderId, entry.created_at);
          currentSessionId = result.lastInsertRowid;
        }
        db.prepare("UPDATE journal_entries SET session_id = ? WHERE id = ?").run(currentSessionId, entry.id);
      }
    }
  }

  db.exec("DELETE FROM journal_entries WHERE is_session_break = 1");
});

// — users: flags —
migrate('019_users_is_demo',               () => { try { db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER DEFAULT 0"); } catch {} });
migrate('020_users_force_password_change', () => { try { db.exec("ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0"); } catch {} });

// — notes + sessions: demo flags —
migrate('021_notes_is_demo',    () => { try { db.exec("ALTER TABLE notes ADD COLUMN is_demo INTEGER DEFAULT 0"); } catch {} });
migrate('022_sessions_is_demo', () => { try { db.exec("ALTER TABLE sessions ADD COLUMN is_demo INTEGER DEFAULT 0"); } catch {} });

// Auto-assign DM role for any existing root campaign folders that don't have one
migrate('023_folder_roles_dm_backfill', () => {
  const rootFolders = db.prepare("SELECT id, user_id FROM notes WHERE is_folder = 1 AND parent_id IS NULL").all();
  for (const folder of rootFolders) {
    db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(folder.id, folder.user_id);
  }
});

// ─── Roadmap schema prep ──────────────────────────────────────────────────────
// Pre-scaffolded for Phase 1 + Phase 2 roadmap features.
// No application logic uses these yet — all are safe, defaulted, and additive.
// When a feature is implemented, its backend route and frontend component
// can rely on the column/table already existing in every deployed database.

// Phase 1 — Snapshot Labels: optional human-readable name per snapshot
migrate('024_snapshot_label', () => { try { db.exec("ALTER TABLE folder_snapshots ADD COLUMN label TEXT DEFAULT NULL"); } catch {} });

// Phase 1 — Named sessions: title for display and session_number for timeline ordering
migrate('025_sessions_title',          () => { try { db.exec("ALTER TABLE sessions ADD COLUMN title TEXT DEFAULT NULL"); } catch {} });
migrate('026_sessions_session_number', () => { try { db.exec("ALTER TABLE sessions ADD COLUMN session_number INTEGER DEFAULT NULL"); } catch {} });

// Phase 2 — Theory Crafting Layer: marks a connection as player-speculative vs confirmed
migrate('027_connections_is_speculative', () => { try { db.exec("ALTER TABLE connections ADD COLUMN is_speculative INTEGER DEFAULT 0"); } catch {} });

// Phase 2 — Quest Tracker: lifecycle status on notes (active | completed | failed | on-hold)
migrate('028_notes_status', () => { try { db.exec("ALTER TABLE notes ADD COLUMN status TEXT DEFAULT NULL"); } catch {} });

// Phase 1 — Session Attendance Tracker table
migrate('029_session_attendance_table', () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_attendance (
      session_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      attended   INTEGER DEFAULT 1,
      PRIMARY KEY (session_id, user_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );
  `);
});

// Phase 1 — Session Prep Checklist table
migrate('030_session_checklist_items_table', () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_checklist_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      content    TEXT    NOT NULL DEFAULT '',
      is_checked INTEGER DEFAULT 0,
      sort_order REAL    DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)    ON DELETE CASCADE
    );
  `);
});

// ─── Phase 3 — Cross-Campaign Inheritance (3-tier model) ──────────────────────
// World layers: root folders marked with is_world=1 that contain campaigns as children

// Phase 3 — World Layer Flag: marks a root folder as a world layer
migrate('031_notes_is_world', () => { try { db.exec("ALTER TABLE notes ADD COLUMN is_world INTEGER DEFAULT 0"); } catch {} });

// Phase 3 — Override Source: points campaign notes that override world-layer notes back to the original
migrate('032_notes_source_note_id', () => { try { db.exec("ALTER TABLE notes ADD COLUMN source_note_id INTEGER DEFAULT NULL"); } catch {} });

// Sidebar / tree: optional emoji icon + short blurb (folders: world / campaign / subfolder styling; notes: scroll-style defaults)
migrate('033_notes_display_icon', () => { try { db.exec("ALTER TABLE notes ADD COLUMN display_icon TEXT DEFAULT NULL"); } catch {} });
migrate('034_notes_display_summary', () => { try { db.exec("ALTER TABLE notes ADD COLUMN display_summary TEXT DEFAULT NULL"); } catch {} });

// ─── Default admin account (created once on first boot) ───────────────────────
const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  const bcrypt = require('bcryptjs');
  const hash   = bcrypt.hashSync('admin', 12);
  db.prepare(
    "INSERT OR IGNORE INTO users (username, password_hash, is_admin, force_password_change) VALUES ('admin', ?, 1, 1)"
  ).run(hash);
  console.log('[boot] Default admin account created (admin/admin) — please change the password!');
}

// ─── Performance indexes ──────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_notes_parent_id        ON notes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user_id          ON notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_source_note      ON notes(source_note_id);
  CREATE INDEX IF NOT EXISTS idx_connections_source     ON connections(source_note_id);
  CREATE INDEX IF NOT EXISTS idx_connections_target     ON connections(target_note_id);
  CREATE INDEX IF NOT EXISTS idx_journal_entries_session ON journal_entries(session_id);
  CREATE INDEX IF NOT EXISTS idx_folder_roles_folder    ON folder_roles(folder_id);
  CREATE INDEX IF NOT EXISTS idx_note_permissions_note  ON note_permissions(note_id);
  CREATE INDEX IF NOT EXISTS idx_note_visibility_note   ON note_visibility(note_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_folder        ON sessions(folder_id);
  CREATE INDEX IF NOT EXISTS idx_session_attendance     ON session_attendance(session_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_session      ON session_checklist_items(session_id);
`);

module.exports = db;
