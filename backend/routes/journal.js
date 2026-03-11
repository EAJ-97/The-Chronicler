const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../utils/access');

const router = express.Router();

function canAccessFolder(uid, folderId, admin) {
  if (!folderId || admin) return true;
  const folder = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(folderId);
  if (!folder) return true;
  if (folder.user_id === uid) return true;
  if (folder.visibility !== 'hidden') return true;
  return !!db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(folderId, uid);
}

// GET journal entries + sessions for a folder
router.get('/', authenticateToken, (req, res) => {
  const { folder_id } = req.query;
  const uid   = req.user.id;
  const admin = isAdmin(uid);
  const fid   = folder_id ? parseInt(folder_id) : null;

  if (!canAccessFolder(uid, fid, admin)) return res.json({ sessions: [], entries: [] });

  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL))
    ORDER BY created_at ASC, id ASC
  `).all(fid, fid);

  const entries = db.prepare(`
    SELECT je.*, u.username AS author_username
    FROM journal_entries je
    JOIN users u ON je.user_id = u.id
    WHERE (je.folder_id = ? OR (? IS NULL AND je.folder_id IS NULL))
      AND je.is_session_break = 0
    ORDER BY je.sort_order ASC, je.id ASC
  `).all(fid, fid);

  res.json({ sessions, entries });
});

// POST create a new journal entry
router.post('/', authenticateToken, (req, res) => {
  const { content, indent_level = 0, folder_id = null, session_id, after_id = null } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'Content is required' });
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  const fid = folder_id ? parseInt(folder_id) : null;

  let sort_order;
  if (after_id) {
    const after = db.prepare('SELECT sort_order FROM journal_entries WHERE id = ?').get(after_id);
    const next  = db.prepare(`
      SELECT sort_order FROM journal_entries
      WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL))
        AND sort_order > ? AND is_session_break = 0
      ORDER BY sort_order ASC LIMIT 1
    `).get(fid, fid, after?.sort_order ?? 0);
    const a = after?.sort_order ?? 0;
    const b = next?.sort_order ?? a + 2;
    sort_order = (a + b) / 2;
  } else {
    const last = db.prepare(`
      SELECT sort_order FROM journal_entries
      WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL)) AND is_session_break = 0
      ORDER BY sort_order DESC LIMIT 1
    `).get(fid, fid);
    sort_order = (last?.sort_order ?? 0) + 1;
  }

  const result = db.prepare(`
    INSERT INTO journal_entries (user_id, folder_id, session_id, content, indent_level, is_session_break, sort_order)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(req.user.id, fid, session_id, content, indent_level, sort_order);

  const entry = db.prepare(`
    SELECT je.*, u.username AS author_username
    FROM journal_entries je JOIN users u ON je.user_id = u.id
    WHERE je.id = ?
  `).get(result.lastInsertRowid);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: fid });
  res.status(201).json(entry);
});

// POST create a new session for a folder
router.post('/sessions', authenticateToken, (req, res) => {
  const { folder_id = null } = req.body;
  const fid = folder_id ? parseInt(folder_id) : null;

  const result = db.prepare('INSERT INTO sessions (folder_id) VALUES (?)').run(fid);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: fid });
  res.status(201).json(session);
});

// DELETE a session — merges its entries into adjacent session
router.delete('/sessions/:id', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const session   = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const fid = session.folder_id;

  const prevSession = db.prepare(`
    SELECT * FROM sessions
    WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL)) AND id < ?
    ORDER BY id DESC LIMIT 1
  `).get(fid, fid, sessionId);

  db.transaction(() => {
    if (prevSession) {
      db.prepare('UPDATE journal_entries SET session_id = ? WHERE session_id = ?')
        .run(prevSession.id, sessionId);
    } else {
      const nextSession = db.prepare(`
        SELECT * FROM sessions
        WHERE (folder_id = ? OR (? IS NULL AND folder_id IS NULL)) AND id > ?
        ORDER BY id ASC LIMIT 1
      `).get(fid, fid, sessionId);
      if (nextSession) {
        db.prepare('UPDATE journal_entries SET session_id = ? WHERE session_id = ?')
          .run(nextSession.id, sessionId);
      } else {
        db.prepare('DELETE FROM journal_entries WHERE session_id = ?').run(sessionId);
      }
    }
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  })();

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: fid });
  res.json({ success: true });
});

// PUT move a session to a different folder
router.put('/sessions/:id/move', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { target_folder_id } = req.body;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (target_folder_id) {
    const folder = db.prepare('SELECT id FROM notes WHERE id = ? AND is_folder = 1').get(target_folder_id);
    if (!folder) return res.status(404).json({ error: 'Target folder not found' });
  }

  const oldFid = session.folder_id;
  const newFid = target_folder_id ? parseInt(target_folder_id) : null;

  db.transaction(() => {
    db.prepare('UPDATE sessions SET folder_id = ? WHERE id = ?').run(newFid, sessionId);
    db.prepare('UPDATE journal_entries SET folder_id = ? WHERE session_id = ?').run(newFid, sessionId);
  })();

  if (req.app.broadcast) {
    req.app.broadcast({ type: 'journal_changed', folder_id: oldFid });
    req.app.broadcast({ type: 'journal_changed', folder_id: newFid });
  }
  res.json({ success: true });
});

// PUT update entry content / indent (owner or admin)
router.put('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (!admin && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Not yours to edit' });

  const { content, indent_level } = req.body;
  const newContent     = content      !== undefined ? content      : entry.content;
  const newIndentLevel = indent_level !== undefined ? indent_level : entry.indent_level;

  db.prepare('UPDATE journal_entries SET content = ?, indent_level = ? WHERE id = ?')
    .run(newContent, Math.max(0, Math.min(6, newIndentLevel)), req.params.id);

  const updated = db.prepare(`
    SELECT je.*, u.username AS author_username
    FROM journal_entries je JOIN users u ON je.user_id = u.id
    WHERE je.id = ?
  `).get(req.params.id);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: entry.folder_id });
  res.json(updated);
});

// DELETE entry (owner or admin)
router.delete('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (!admin && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Not yours to delete' });

  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: entry.folder_id });
  res.json({ success: true });
});

// POST promote entry to a note, or append to existing note
router.post('/:id/promote', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (!admin && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Not yours to promote' });

  const { mode = 'create', parent_id, category = 'general', markdown_content, target_note_id } = req.body;

  if (mode === 'append') {
    // Append markdown-formatted content to an existing note
    if (!target_note_id) return res.status(400).json({ error: 'target_note_id required for append mode' });
    const target = db.prepare('SELECT * FROM notes WHERE id = ?').get(target_note_id);
    if (!target) return res.status(404).json({ error: 'Target note not found' });
    const appendText = '\n\n' + (markdown_content || entry.content);
    const newContent = (target.content || '') + appendText;
    db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newContent, target_note_id);
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(target_note_id);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return res.json(updated);
  }

  // mode === 'create' — create new note
  const title   = (req.body.title || entry.content.split('\n')[0]).slice(0, 80) || 'Journal Note';
  const noteContent = markdown_content !== undefined ? markdown_content : '';

  const result = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_shared, category)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(req.user.id, parent_id || entry.folder_id || null, title, noteContent, category);

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
  res.status(201).json(note);
});

module.exports = router;
