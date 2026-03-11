const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_DIR || '/data';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'dnd_notes.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_open', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('demo_seeded', 'false');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_enabled', 'false');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_api_key', '');

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    is_shared INTEGER DEFAULT 0,
    is_folder INTEGER DEFAULT 0,
    category TEXT DEFAULT 'general',
    color TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'private',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS note_permissions (
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (note_id, user_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id INTEGER NOT NULL,
    target_note_id INTEGER NOT NULL,
    label TEXT DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE(source_note_id, target_note_id)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    folder_id INTEGER DEFAULT NULL,
    content TEXT NOT NULL DEFAULT '',
    indent_level INTEGER DEFAULT 0,
    is_session_break INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    tag TEXT NOT NULL COLLATE NOCASE,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, tag)
  );

  CREATE TABLE IF NOT EXISTS note_visibility (
    note_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    hidden INTEGER DEFAULT 0,
    PRIMARY KEY (note_id, user_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS folder_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL,
    saved_by INTEGER NOT NULL,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    snapshot_json TEXT NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (saved_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS note_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS folder_roles (
    folder_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'dm',
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (folder_id, user_id),
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    folder_id INTEGER NOT NULL,
    generated_by INTEGER NOT NULL,
    tone TEXT NOT NULL DEFAULT 'chronicle',
    content TEXT NOT NULL,
    is_dm_only INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (generated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS recap_usage (
    session_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, user_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// FTS5
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

// Populate FTS for existing notes not yet indexed
try {
  const ftsCount = db.prepare("SELECT COUNT(*) as c FROM notes_fts").get().c;
  const notesCount = db.prepare("SELECT COUNT(*) as c FROM notes").get().c;
  if (ftsCount < notesCount) {
    db.exec("INSERT INTO notes_fts(rowid, title, content) SELECT id, title, content FROM notes");
  }
} catch (e) {}

// Runtime migrations
const noteColumns = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
if (!noteColumns.includes('parent_id'))  db.exec('ALTER TABLE notes ADD COLUMN parent_id INTEGER DEFAULT NULL');
if (!noteColumns.includes('is_folder'))  db.exec('ALTER TABLE notes ADD COLUMN is_folder INTEGER DEFAULT 0');
if (!noteColumns.includes('sort_order')) db.exec('ALTER TABLE notes ADD COLUMN sort_order INTEGER DEFAULT 0');
if (!noteColumns.includes('visibility')) db.exec('ALTER TABLE notes ADD COLUMN visibility TEXT DEFAULT \'private\'');

// Migrate is_shared → visibility for existing rows
db.exec(`
  UPDATE notes SET visibility = 'public'  WHERE is_shared = 1 AND visibility = 'private';
  UPDATE notes SET visibility = 'private' WHERE is_shared = 0 AND visibility = 'public';
`);

const journalColumns = db.prepare("PRAGMA table_info(journal_entries)").all().map(c => c.name);
if (!journalColumns.includes('folder_id'))        db.exec('ALTER TABLE journal_entries ADD COLUMN folder_id INTEGER DEFAULT NULL');
if (!journalColumns.includes('is_session_break')) db.exec('ALTER TABLE journal_entries ADD COLUMN is_session_break INTEGER DEFAULT 0');
if (!journalColumns.includes('sort_order'))       db.exec('ALTER TABLE journal_entries ADD COLUMN sort_order REAL DEFAULT 0');
// Backfill sort_order from rowid so existing entries keep their order
db.exec('UPDATE journal_entries SET sort_order = id WHERE sort_order = 0');

// Significance tier: 'major' | 'standard' | 'minor'
if (!noteColumns.includes('significance')) db.exec("ALTER TABLE notes ADD COLUMN significance TEXT DEFAULT 'standard'");

// Narrative weight: 'landmark' | 'node' | 'detail'
if (!noteColumns.includes('narrative_weight')) db.exec("ALTER TABLE notes ADD COLUMN narrative_weight TEXT DEFAULT 'node'");

// Soft delete: notes are flagged rather than hard-deleted
const noteColumns2 = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
if (!noteColumns2.includes('deleted_at'))          db.exec("ALTER TABLE notes ADD COLUMN deleted_at DATETIME DEFAULT NULL");
if (!noteColumns2.includes('original_parent_id'))  db.exec("ALTER TABLE notes ADD COLUMN original_parent_id INTEGER DEFAULT NULL");
if (!noteColumns2.includes('recovered'))           db.exec("ALTER TABLE notes ADD COLUMN recovered INTEGER DEFAULT 0");
if (!noteColumns2.includes('is_dm_only'))          db.exec("ALTER TABLE notes ADD COLUMN is_dm_only INTEGER DEFAULT 0");

// Sessions table — each journal session is a first-class record
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES notes(id) ON DELETE CASCADE
  );
`);

// Add session_id to journal_entries if not present
const journalColumns2 = db.prepare("PRAGMA table_info(journal_entries)").all().map(c => c.name);
if (!journalColumns2.includes('session_id')) {
  db.exec('ALTER TABLE journal_entries ADD COLUMN session_id INTEGER DEFAULT NULL');
}

// Backfill sessions from is_session_break markers (runs once — skipped if already done)
const needsBackfill = db.prepare("SELECT COUNT(*) as c FROM journal_entries WHERE session_id IS NULL AND is_session_break = 0").get().c > 0
  || db.prepare("SELECT COUNT(*) as c FROM journal_entries WHERE is_session_break = 1").get().c > 0;

if (needsBackfill) {
  const backfill = db.transaction(() => {
    // Get all distinct folder_ids (including null)
    const folderIds = db.prepare(`
      SELECT DISTINCT folder_id FROM journal_entries ORDER BY folder_id ASC
    `).all().map(r => r.folder_id);

    for (const folderId of folderIds) {
      const entries = db.prepare(`
        SELECT id, is_session_break, created_at FROM journal_entries
        WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL))
        ORDER BY sort_order ASC, id ASC
      `).all(folderId, folderId);

      if (entries.length === 0) continue;

      // Scan through entries, creating a session each time we hit a break marker
      let currentSessionId = null;

      for (const entry of entries) {
        if (entry.is_session_break) {
          // This marker opens a new session — use its timestamp
          const result = db.prepare(
            'INSERT INTO sessions (folder_id, created_at) VALUES (?, ?)'
          ).run(folderId, entry.created_at);
          currentSessionId = result.lastInsertRowid;
        } else {
          // First real entry before any break — need a session for it
          if (currentSessionId === null) {
            const result = db.prepare(
              'INSERT INTO sessions (folder_id, created_at) VALUES (?, ?)'
            ).run(folderId, entry.created_at);
            currentSessionId = result.lastInsertRowid;
          }
          db.prepare('UPDATE journal_entries SET session_id = ? WHERE id = ?')
            .run(currentSessionId, entry.id);
        }
      }
    }

    // Delete all break marker rows — no longer needed
    db.exec('DELETE FROM journal_entries WHERE is_session_break = 1');
  });

  backfill();
}

// Demo flag on users and notes
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('is_demo'))              db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER DEFAULT 0");
if (!userCols.includes('force_password_change')) db.exec("ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0");

const noteCols3 = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
if (!noteCols3.includes('is_demo')) db.exec("ALTER TABLE notes ADD COLUMN is_demo INTEGER DEFAULT 0");

// Sessions demo flag
const sessionCols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
if (!sessionCols.includes('is_demo')) db.exec("ALTER TABLE sessions ADD COLUMN is_demo INTEGER DEFAULT 0");

// Auto-assign DM role for existing root campaign folders (one-time migration)
const rootFolders = db.prepare("SELECT id, user_id FROM notes WHERE is_folder = 1 AND parent_id IS NULL").all();
for (const folder of rootFolders) {
  db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(folder.id, folder.user_id);
}

// Default admin account — created once on first boot
const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin', 12);
  db.prepare(
    "INSERT OR IGNORE INTO users (username, password_hash, is_admin, force_password_change) VALUES ('admin', ?, 1, 1)"
  ).run(hash);
  console.log('[boot] Default admin account created (admin/admin) — please change the password!');
}

// Indexes on frequently-queried foreign key columns
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_notes_parent_id ON notes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_note_id);
  CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_note_id);
  CREATE INDEX IF NOT EXISTS idx_journal_entries_session ON journal_entries(session_id);
  CREATE INDEX IF NOT EXISTS idx_folder_roles_folder ON folder_roles(folder_id);
  CREATE INDEX IF NOT EXISTS idx_note_permissions_note ON note_permissions(note_id);
  CREATE INDEX IF NOT EXISTS idx_note_visibility_note ON note_visibility(note_id);
`);

module.exports = db;
