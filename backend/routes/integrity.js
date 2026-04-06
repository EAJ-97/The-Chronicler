/**
 * Campaign data integrity checks for DMs and admins.
 */

const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOfFolder } = require('../utils/access');

const router = express.Router();

/**
 * Collects all note ids in the subtree rooted at folderId (including folderId).
 * @param {number} folderId
 * @returns {Set<number>}
 */
function subtreeNoteIds(folderId) {
  const ids = new Set();
  const q = [folderId];
  while (q.length) {
    const id = q.shift();
    if (ids.has(id)) continue;
    ids.add(id);
    db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(id).forEach((r) => q.push(r.id));
  }
  return ids;
}

/**
 * GET /integrity/:folderId — structured report of broken refs and anomalies.
 */
router.get('/:folderId', authenticateToken, (req, res) => {
  const folderId = parseInt(req.params.folderId, 10);
  if (!Number.isFinite(folderId)) return res.status(400).json({ error: 'Invalid folder id' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  const folder = db.prepare('SELECT id, is_folder, title FROM notes WHERE id = ? AND deleted_at IS NULL').get(folderId);
  if (!folder || !folder.is_folder) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  if (!admin && !isDMOfFolder(folderId, uid)) {
    return res.status(403).json({ error: 'Only DMs or admins can run integrity checks' });
  }

  const ids = subtreeNoteIds(folderId);
  const idList = [...ids];

  const broken_connections = [];
  const allConns = db.prepare('SELECT id, source_note_id, target_note_id FROM connections').all();
  for (const c of allConns) {
    const touches = ids.has(c.source_note_id) || ids.has(c.target_note_id);
    if (!touches) continue;
    const sn = db.prepare('SELECT id, deleted_at FROM notes WHERE id = ?').get(c.source_note_id);
    const tn = db.prepare('SELECT id, deleted_at FROM notes WHERE id = ?').get(c.target_note_id);
    if (!sn || sn.deleted_at) {
      broken_connections.push({ id: c.id, issue: 'missing_or_trashed_source', source_note_id: c.source_note_id });
    } else if (!tn || tn.deleted_at) {
      broken_connections.push({ id: c.id, issue: 'missing_or_trashed_target', target_note_id: c.target_note_id });
    }
  }

  const orphan_notes = [];
  for (const nid of idList) {
    const n = db.prepare('SELECT id, parent_id, title FROM notes WHERE id = ?').get(nid);
    if (n && n.parent_id != null && !ids.has(n.parent_id)) {
      const p = db.prepare('SELECT id FROM notes WHERE id = ?').get(n.parent_id);
      if (!p) orphan_notes.push({ id: n.id, title: n.title, parent_id: n.parent_id, issue: 'parent_missing' });
    }
  }

  const bad_permissions = [];
  const permRows = db.prepare(`
    SELECT np.note_id, np.user_id FROM note_permissions np
    WHERE np.note_id IN (${idList.map(() => '?').join(',')})
  `).all(...idList);
  for (const p of permRows) {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(p.user_id);
    if (!u) bad_permissions.push({ note_id: p.note_id, user_id: p.user_id, issue: 'user_missing' });
  }

  const orphan_journal_entries = [];
  const jrows = db
    .prepare('SELECT je.id, je.session_id, je.folder_id FROM journal_entries je WHERE je.folder_id = ?')
    .all(folderId);
  for (const j of jrows) {
    const s = db.prepare('SELECT id FROM sessions WHERE id = ?').get(j.session_id);
    if (!s) orphan_journal_entries.push({ entry_id: j.id, session_id: j.session_id, issue: 'session_missing' });
  }

  res.json({
    folder_id: folderId,
    broken_connections,
    orphan_notes,
    bad_permissions,
    orphan_journal_entries,
  });
});

module.exports = router;
