const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOfFolder } = require('../utils/access');

const router = express.Router();

/** Max characters per prep checklist line item (session_checklist_items.content). */
const CHECKLIST_CONTENT_MAX = 500;

function canAccessFolder(uid, folderId, admin) {
  if (!folderId || admin) return true;
  const folder = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(folderId);
  if (!folder) return true;
  if (folder.user_id === uid) return true;
  if (folder.visibility !== 'hidden') return true;
  return !!db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(folderId, uid);
}

/**
 * Whether the user may view/edit DM prep checklists for this journal folder (campaign root id).
 * @param {number} uid
 * @param {number|null} folderId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canDmPrepChecklist(uid, folderId, admin) {
  if (!folderId) return false;
  if (admin) return true;
  return isDMOfFolder(folderId, uid);
}

/**
 * Loads checklist rows for the given session ids, grouped by session_id (string keys for JSON).
 * @param {number[]} sessionIds
 * @returns {Record<string, object[]>}
 */
function loadSessionChecklistsGrouped(sessionIds) {
  const out = {};
  if (!sessionIds.length) return out;
  const ph = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, session_id, content, is_checked, sort_order, created_by, created_at
    FROM session_checklist_items
    WHERE session_id IN (${ph})
    ORDER BY sort_order ASC, id ASC
  `).all(...sessionIds);
  for (const r of rows) {
    const key = String(r.session_id);
    if (!out[key]) out[key] = [];
    out[key].push(r);
  }
  return out;
}

/**
 * Campaign root folder: all users who are DMs or have note_permissions on the campaign (for attendance roster).
 * @param {number} folderId
 * @returns {{ id: number, username: string, is_dm: number }[]}
 */
function getCampaignMembersForAttendance(folderId) {
  if (!folderId) return [];
  return db.prepare(`
    SELECT DISTINCT u.id, u.username,
      CASE WHEN EXISTS (SELECT 1 FROM folder_roles fr WHERE fr.folder_id = ? AND fr.user_id = u.id) THEN 1 ELSE 0 END as is_dm
    FROM users u
    WHERE EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = ? AND np.user_id = u.id)
       OR EXISTS (SELECT 1 FROM folder_roles fr WHERE fr.folder_id = ? AND fr.user_id = u.id)
    ORDER BY u.username ASC
  `).all(folderId, folderId, folderId);
}

/**
 * Per-session attendance merged with campaign roster. `attended` is null if no row yet, else boolean.
 * @param {number[]} sessionIds
 * @param {number|null} folderId
 * @returns {Record<string, { user_id: number, username: string, is_dm: number, attended: boolean|null }[]>}
 */
function loadSessionAttendanceGrouped(sessionIds, folderId) {
  const out = {};
  if (!folderId || !sessionIds.length) return out;
  const members = getCampaignMembersForAttendance(folderId);
  for (const sid of sessionIds) {
    const rows = db.prepare('SELECT user_id, attended FROM session_attendance WHERE session_id = ?').all(sid);
    const map = {};
    rows.forEach((r) => { map[r.user_id] = r.attended === 1; });
    out[String(sid)] = members.map((m) => ({
      user_id: m.id,
      username: m.username,
      is_dm: m.is_dm,
      attended: map[m.id] === undefined ? null : map[m.id],
    }));
  }
  return out;
}

/**
 * True if user_id is a DM or granted member of the campaign root folder.
 * @param {number} folderId
 * @param {number} userId
 */
function isUserCampaignMember(folderId, userId) {
  if (!folderId || !userId) return false;
  return !!db.prepare(`
    SELECT 1 FROM users u WHERE u.id = ?
      AND (
        EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = ? AND np.user_id = u.id)
        OR EXISTS (SELECT 1 FROM folder_roles fr WHERE fr.folder_id = ? AND fr.user_id = u.id)
      )
  `).get(userId, folderId, folderId);
}

// GET journal entries + sessions for a folder
router.get('/', authenticateToken, (req, res) => {
  const { folder_id } = req.query;
  const uid   = req.user.id;
  const admin = isAdmin(uid);
  const fid   = folder_id ? parseInt(folder_id) : null;

  if (!canAccessFolder(uid, fid, admin)) {
    return res.json({ sessions: [], entries: [], session_checklists: {}, session_attendance: {} });
  }

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

  let session_checklists = {};
  if (canDmPrepChecklist(uid, fid, admin) && sessions.length) {
    session_checklists = loadSessionChecklistsGrouped(sessions.map(s => s.id));
  }

  let session_attendance = {};
  if (fid && sessions.length) {
    session_attendance = loadSessionAttendanceGrouped(sessions.map(s => s.id), fid);
  }

  res.json({ sessions, entries, session_checklists, session_attendance });
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

/**
 * Resolves a session row or sends 404. Used by prep checklist routes.
 * @param {import('express').Response} res
 * @param {number} sessionId
 * @returns {object|null} session row
 */
function sessionOr404(res, sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
}

/**
 * Ensures the user is admin or DM of the session's campaign folder; otherwise sends 403.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ folder_id: number|null }} session
 * @returns {{ folderId: number }|null}
 */
function dmPrepOr403(req, res, session) {
  const uid = req.user.id;
  const admin = isAdmin(uid);
  const fid = session.folder_id;
  if (fid == null) {
    res.status(403).json({ error: 'Prep checklist is only available for campaign sessions' });
    return null;
  }
  if (!canDmPrepChecklist(uid, fid, admin)) {
    res.status(403).json({ error: 'Only the DM or an admin can change the prep checklist' });
    return null;
  }
  return { folderId: fid };
}

// POST clear all checkmarks for a session's prep checklist (DM/admin). Broadcasts journal_changed.
router.post('/sessions/:sessionId/checklist-items/reset-checks', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessionOr404(res, sessionId);
  if (!session) return;
  const ctx = dmPrepOr403(req, res, session);
  if (!ctx) return;

  db.prepare('UPDATE session_checklist_items SET is_checked = 0 WHERE session_id = ?').run(sessionId);
  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: ctx.folderId });
  res.json({ success: true });
});

// POST add a prep checklist line item (DM/admin). Body: { content }. Broadcasts journal_changed.
router.post('/sessions/:sessionId/checklist-items', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessionOr404(res, sessionId);
  if (!session) return;
  const ctx = dmPrepOr403(req, res, session);
  if (!ctx) return;

  const raw = req.body?.content;
  if (raw == null || typeof raw !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }
  const content = raw.trim().slice(0, CHECKLIST_CONTENT_MAX);
  if (!content) return res.status(400).json({ error: 'content cannot be empty' });

  const last = db.prepare(`
    SELECT sort_order FROM session_checklist_items WHERE session_id = ? ORDER BY sort_order DESC LIMIT 1
  `).get(sessionId);
  const sort_order = (last?.sort_order ?? 0) + 1;

  const result = db.prepare(`
    INSERT INTO session_checklist_items (session_id, content, is_checked, sort_order, created_by)
    VALUES (?, ?, 0, ?, ?)
  `).run(sessionId, content, sort_order, req.user.id);

  const row = db.prepare(`
    SELECT id, session_id, content, is_checked, sort_order, created_by, created_at
    FROM session_checklist_items WHERE id = ?
  `).get(result.lastInsertRowid);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: ctx.folderId });
  res.status(201).json(row);
});

// PUT update a checklist item (content and/or is_checked). DM/admin. Broadcasts journal_changed.
router.put('/checklist-items/:itemId', authenticateToken, (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const item = db.prepare(`
    SELECT ci.*, s.folder_id AS session_folder_id
    FROM session_checklist_items ci
    JOIN sessions s ON s.id = ci.session_id
    WHERE ci.id = ?
  `).get(itemId);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  const session = { folder_id: item.session_folder_id };
  const ctx = dmPrepOr403(req, res, session);
  if (!ctx) return;

  const { content, is_checked } = req.body;
  let newContent = item.content;
  if (content !== undefined) {
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    newContent = content.trim().slice(0, CHECKLIST_CONTENT_MAX);
    if (!newContent) return res.status(400).json({ error: 'content cannot be empty' });
  }
  let newChecked = item.is_checked ? 1 : 0;
  if (is_checked !== undefined) {
    newChecked = is_checked ? 1 : 0;
  }

  db.prepare('UPDATE session_checklist_items SET content = ?, is_checked = ? WHERE id = ?')
    .run(newContent, newChecked, itemId);

  const row = db.prepare(`
    SELECT id, session_id, content, is_checked, sort_order, created_by, created_at
    FROM session_checklist_items WHERE id = ?
  `).get(itemId);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: ctx.folderId });
  res.json(row);
});

// DELETE a prep checklist item. DM/admin. Broadcasts journal_changed.
router.delete('/checklist-items/:itemId', authenticateToken, (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const item = db.prepare(`
    SELECT ci.id, s.folder_id AS session_folder_id
    FROM session_checklist_items ci
    JOIN sessions s ON s.id = ci.session_id
    WHERE ci.id = ?
  `).get(itemId);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  const session = { folder_id: item.session_folder_id };
  const ctx = dmPrepOr403(req, res, session);
  if (!ctx) return;

  db.prepare('DELETE FROM session_checklist_items WHERE id = ?').run(itemId);
  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: ctx.folderId });
  res.json({ success: true });
});

// PUT set one party member's attendance for a session (DM/admin). Body: { user_id, attended }.
router.put('/sessions/:sessionId/attendance', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessionOr404(res, sessionId);
  if (!session) return;

  const uid = req.user.id;
  const admin = isAdmin(uid);
  const fid = session.folder_id;
  if (fid == null) {
    return res.status(403).json({ error: 'Attendance applies to campaign sessions only' });
  }
  if (!canDmPrepChecklist(uid, fid, admin)) {
    return res.status(403).json({ error: 'Only the DM or an admin can update attendance' });
  }

  const targetUserId = parseInt(req.body?.user_id, 10);
  const attended = req.body?.attended;
  if (!Number.isFinite(targetUserId) || attended === undefined || typeof attended !== 'boolean') {
    return res.status(400).json({ error: 'user_id (number) and attended (boolean) are required' });
  }
  if (!isUserCampaignMember(fid, targetUserId)) {
    return res.status(400).json({ error: 'User is not a member of this campaign' });
  }

  db.prepare(`
    INSERT INTO session_attendance (session_id, user_id, attended)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, user_id) DO UPDATE SET attended = excluded.attended
  `).run(sessionId, targetUserId, attended ? 1 : 0);

  if (req.app.broadcast) req.app.broadcast({ type: 'journal_changed', folder_id: fid });
  res.json({ success: true, session_id: sessionId, user_id: targetUserId, attended });
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
