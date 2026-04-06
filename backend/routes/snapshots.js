const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOfFolder } = require('../utils/access');

const router = express.Router();

const SNAPSHOT_LIMIT = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
/** Max length for optional human-readable snapshot labels (stored in folder_snapshots.label). */
const SNAPSHOT_LABEL_MAX = 200;

/**
 * Trims and caps snapshot label from JSON body; returns null when missing or blank after trim.
 * @param {unknown} raw - Typically req.body.label
 * @returns {string|null} Stored value or null (SQLite column)
 */
function normalizeSnapshotLabel(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, SNAPSHOT_LABEL_MAX);
  return t.length ? t : null;
}

function canManageFolder(folderId, userId) {
  return isAdmin(userId) || isDMOfFolder(folderId, userId);
}

// Recursively collect all notes in a folder subtree using a single SQL CTE
function collectSubtree(folderId) {
  const allNodes = db.prepare(`
    WITH RECURSIVE subtree AS (
      SELECT * FROM notes WHERE parent_id = ?
      UNION ALL
      SELECT n.* FROM notes n JOIN subtree s ON n.parent_id = s.id
    )
    SELECT * FROM subtree
  `).all(folderId);

  if (allNodes.length === 0) return [];

  // Bulk-load all tags for the subtree in one query instead of N+1
  const ids = allNodes.map(n => n.id);
  const tagRows = db.prepare(
    `SELECT note_id, tag FROM note_tags WHERE note_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);

  const tagMap = {};
  tagRows.forEach(r => {
    if (!tagMap[r.note_id]) tagMap[r.note_id] = [];
    tagMap[r.note_id].push(r.tag);
  });

  return allNodes.map(n => ({ ...n, tags: tagMap[n.id] || [] }));
}

// GET all campaign folders + their snapshots (admin only)
router.get('/', authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' });

  const campaigns = db.prepare(`
    SELECT n.id, n.title, n.user_id, n.created_at, u.username AS owner
    FROM notes n JOIN users u ON n.user_id = u.id
    WHERE n.is_folder = 1 AND n.parent_id IS NULL
    ORDER BY u.username ASC, n.title ASC
  `).all();

  const result = campaigns.map(c => {
    const snapshots = db.prepare(`
      SELECT fs.id, fs.saved_at, fs.snapshot_json, fs.label, u.username AS saved_by
      FROM folder_snapshots fs JOIN users u ON fs.saved_by = u.id
      WHERE fs.folder_id = ? ORDER BY fs.saved_at DESC
    `).all(c.id);

    const latest = snapshots[0] || null;
    const cooldownMs = latest
      ? Math.max(0, COOLDOWN_MS - (Date.now() - new Date(latest.saved_at).getTime()))
      : 0;

    return {
      ...c,
      snapshots: snapshots.map(s => {
        let note_count = 0;
        try {
          const parsed = JSON.parse(s.snapshot_json);
          note_count = Array.isArray(parsed.notes) ? parsed.notes.length : 0;
        } catch (e) {}
        return {
          id: s.id,
          saved_at: s.saved_at,
          saved_by: s.saved_by,
          note_count,
          label: s.label || null,
        };
      }),
      cooldown_remaining_ms: cooldownMs,
    };
  });

  res.json(result);
});

// GET snapshots for a folder
router.get('/:folderId', authenticateToken, (req, res) => {
  const { folderId } = req.params;
  const folder = db.prepare('SELECT id, user_id FROM notes WHERE id = ? AND is_folder = 1').get(folderId);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const snapshots = db.prepare(`
    SELECT fs.id, fs.folder_id, fs.saved_at, fs.label, u.username AS saved_by
    FROM folder_snapshots fs JOIN users u ON fs.saved_by = u.id
    WHERE fs.folder_id = ? ORDER BY fs.saved_at DESC
  `).all(folderId);

  // Include cooldown info
  const latest = snapshots[0];
  const cooldownRemaining = latest
    ? Math.max(0, COOLDOWN_MS - (Date.now() - new Date(latest.saved_at).getTime()))
    : 0;

  res.json({ snapshots, cooldown_remaining_ms: cooldownRemaining });
});

// POST create a snapshot
router.post('/:folderId', authenticateToken, (req, res) => {
  const { folderId } = req.params;
  if (!canManageFolder(folderId, req.user.id)) {
    return res.status(403).json({ error: 'Only the folder owner or an admin can create snapshots' });
  }

  const folder = db.prepare('SELECT * FROM notes WHERE id = ? AND is_folder = 1').get(folderId);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const label = normalizeSnapshotLabel(req.body?.label);

  // Enforce cooldown (admins are exempt)
  const latest = db.prepare('SELECT saved_at FROM folder_snapshots WHERE folder_id = ? ORDER BY saved_at DESC LIMIT 1').get(folderId);
  if (latest && !isAdmin(req.user.id)) {
    const elapsed = Date.now() - new Date(latest.saved_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return res.status(429).json({
        error: `Snapshot cooldown active. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`,
        cooldown_remaining_ms: COOLDOWN_MS - elapsed,
      });
    }
  }

  // Build snapshot: folder itself + all descendants
  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(folder.id).map(r => r.tag);
  const snapshot = {
    folder: { ...folder, tags },
    notes: collectSubtree(folderId),
  };

  db.prepare('INSERT INTO folder_snapshots (folder_id, saved_by, snapshot_json, label) VALUES (?, ?, ?, ?)')
    .run(folderId, req.user.id, JSON.stringify(snapshot), label);

  // Purge oldest beyond limit
  const all = db.prepare('SELECT id FROM folder_snapshots WHERE folder_id = ? ORDER BY saved_at DESC').all(folderId);
  if (all.length > SNAPSHOT_LIMIT) {
    all.slice(SNAPSHOT_LIMIT).forEach(s => db.prepare('DELETE FROM folder_snapshots WHERE id = ?').run(s.id));
  }

  const snapshots = db.prepare(`
    SELECT fs.id, fs.folder_id, fs.saved_at, fs.label, u.username AS saved_by
    FROM folder_snapshots fs JOIN users u ON fs.saved_by = u.id
    WHERE fs.folder_id = ? ORDER BY fs.saved_at DESC
  `).all(folderId);

  res.json({ snapshots, cooldown_remaining_ms: COOLDOWN_MS });
});

// POST restore a snapshot (non-destructive)
router.post('/:folderId/restore/:snapshotId', authenticateToken, (req, res) => {
  const { folderId, snapshotId } = req.params;
  if (!canManageFolder(folderId, req.user.id)) {
    return res.status(403).json({ error: 'Only the folder owner or an admin can restore snapshots' });
  }

  const snap = db.prepare('SELECT * FROM folder_snapshots WHERE id = ? AND folder_id = ?').get(snapshotId, folderId);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  const { folder: snapFolder, notes: snapNotes } = JSON.parse(snap.snapshot_json);

  // Build full list — root folder first, then all descendants
  // Sort so parents always come before children (avoids FK constraint failures on re-insert)
  const rawNodes = snapFolder ? [{ ...snapFolder, is_folder: 1 }, ...snapNotes] : snapNotes;
  const nodeMap = {};
  rawNodes.forEach(n => { nodeMap[n.id] = n; });
  const allNodes = [];
  const visited = new Set();
  function addNode(n) {
    if (visited.has(n.id)) return;
    if (n.parent_id && nodeMap[n.parent_id] && !visited.has(n.parent_id)) {
      addNode(nodeMap[n.parent_id]); // ensure parent inserted first
    }
    visited.add(n.id);
    allNodes.push(n);
  }
  rawNodes.forEach(n => addNode(n));

  const restoreNode = (sn) => {
    const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(sn.id);
    if (existing) {
      db.prepare(`
        UPDATE notes SET title = ?, content = ?, category = ?, color = ?,
          is_shared = ?, visibility = ?, parent_id = ?, is_folder = ?,
          deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sn.title, sn.content, sn.category, sn.color, sn.is_shared, sn.visibility, sn.parent_id, sn.is_folder, sn.id);
    } else {
      db.prepare(`
        INSERT INTO notes (id, user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sn.id, sn.user_id, sn.parent_id, sn.title, sn.content, sn.is_shared, sn.is_folder, sn.category, sn.color, sn.sort_order, sn.visibility);
      // Re-assign DM role if root folder was recreated
      if (!sn.parent_id && sn.is_folder) {
        db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(sn.id, sn.user_id);
      }
    }
    // Restore tags
    db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(sn.id);
    (sn.tags || []).forEach(tag => {
      db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)').run(sn.id, tag);
    });
  };

  // Must be set outside the transaction in better-sqlite3
  db.pragma('defer_foreign_keys = ON');

  const errors = [];
  const restore = db.transaction(() => {
    allNodes.forEach(sn => {
      try { restoreNode(sn); }
      catch (e) { errors.push({ id: sn.id, title: sn.title, err: e.message }); }
    });
  });
  restore();

  if (errors.length) console.warn('[snapshot/restore] Some nodes failed:', errors);
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
  res.json({ success: true, restored: allNodes.length - errors.length, skipped: errors.length, errors });
});

// GET snapshot contents for debugging
router.get('/:folderId/inspect/:snapshotId', authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' });
  const snap = db.prepare('SELECT * FROM folder_snapshots WHERE id = ? AND folder_id = ?')
    .get(req.params.snapshotId, req.params.folderId);
  if (!snap) return res.status(404).json({ error: 'Not found' });
  const data = JSON.parse(snap.snapshot_json);
  res.json({
    saved_at: snap.saved_at,
    label: snap.label || null,
    root_folder: data.folder?.title,
    note_count: data.notes?.length,
    notes: data.notes?.map(n => ({ id: n.id, title: n.title, parent_id: n.parent_id, is_folder: n.is_folder })),
  });
});

module.exports = router;
