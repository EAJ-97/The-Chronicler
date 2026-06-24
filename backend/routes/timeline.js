/**
 * Campaign timeline API — horizontal axis with click-drag branch boxes linked to notes.
 * Boxes are placed on the line via anchor_x + branch geometry; note_id is optional until filled.
 */

const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const {
  isAdmin,
  isDMOfFolder,
  isGrantedUser,
  isNoteUnderCompletedArchive,
  isDMOf,
} = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');

const router = express.Router();

/**
 * Whether the user may read timeline data for a campaign folder (member or admin).
 * @param {number} uid
 * @param {number|null} folderId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canAccessFolder(uid, folderId, admin) {
  if (!folderId || admin) return true;
  const folder = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ? AND deleted_at IS NULL').get(folderId);
  if (!folder) return false;
  if (folder.user_id === uid) return true;
  if (folder.visibility !== 'hidden') return true;
  return !!db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(folderId, uid);
}

/**
 * Whether the user may view a note row on the timeline (shared visibility rules).
 * @param {number} noteId
 * @param {number} uid
 * @param {boolean} admin
 * @returns {boolean}
 */
function canSeeNote(noteId, uid, admin) {
  if (admin) return true;
  const note = db.prepare('SELECT user_id, visibility, is_dm_only, deleted_at FROM notes WHERE id = ?').get(noteId);
  if (!note || note.deleted_at) return false;
  if (note.is_dm_only && !isDMOf(noteId, uid)) return false;
  if (note.user_id === uid) return true;
  if (note.visibility === 'shared') return true;
  return isGrantedUser(noteId, uid);
}

/**
 * True when the note lives in the subtree of folderId (including folderId).
 * @param {number} noteId
 * @param {number} folderId
 * @returns {boolean}
 */
function noteUnderFolder(noteId, folderId) {
  let cur = db.prepare('SELECT id, parent_id FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  while (cur) {
    if (cur.id === folderId) return true;
    if (!cur.parent_id) return false;
    cur = db.prepare('SELECT id, parent_id FROM notes WHERE id = ? AND deleted_at IS NULL').get(cur.parent_id);
  }
  return false;
}

/**
 * Sends 403 when timeline mutations are blocked on archived campaigns.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number|null|undefined} folderId
 * @returns {boolean}
 */
function timelineArchivedOr403(req, res, folderId) {
  if (folderId == null) return false;
  if (isAdmin(req.user.id)) return false;
  if (isNoteUnderCompletedArchive(folderId)) {
    res.status(403).json({ error: 'This campaign or world is marked completed; timeline is read-only.' });
    return true;
  }
  return false;
}

/**
 * Blocks timeline mutations under demo campaigns for non-admins.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number|null|undefined} folderId
 * @returns {boolean}
 */
function timelineDemoReadonlyOr403(req, res, folderId) {
  if (folderId == null) return false;
  const msg = demoMutateForbiddenMessage(req.user.id, folderId);
  if (msg) {
    res.status(403).json({ error: msg });
    return true;
  }
  return false;
}

/**
 * Whether the user may edit the campaign timeline (DM or admin).
 * @param {number} uid
 * @param {number} folderId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canEditTimeline(uid, folderId, admin) {
  if (admin) return true;
  return isDMOfFolder(folderId, uid);
}

/**
 * Broadcasts timeline_changed so clients refresh the horizontal view.
 * @param {import('express').Application} app
 * @param {number} folderId
 */
function broadcastTimelineChanged(app, folderId) {
  if (typeof app.broadcast === 'function') {
    app.broadcast({ type: 'timeline_changed', folder_id: folderId });
  }
}

/**
 * Parses branch path JSON from the database.
 * @param {string|null|undefined} raw
 * @returns {Array<[number, number]>|null}
 */
function parsePathJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Attaches note metadata or placeholder flag to a timeline box row.
 * @param {object} point
 * @param {number} uid
 * @param {boolean} admin
 * @returns {object|null}
 */
function enrichBox(point, uid, admin) {
  const base = {
    ...point,
    path: parsePathJson(point.path_json),
    anchor_x: point.anchor_x ?? 0,
    end_x: point.end_x ?? 0,
    end_y: point.end_y ?? -100,
  };

  if (point.note_id == null) {
    return {
      ...base,
      is_placeholder: true,
      note_title: null,
      display_label: point.label_override?.trim() || null,
      time_label: point.time_label || '',
    };
  }

  if (!canSeeNote(point.note_id, uid, admin)) return null;
  const note = db.prepare(
    'SELECT id, title, category, is_folder, is_dm_only FROM notes WHERE id = ? AND deleted_at IS NULL'
  ).get(point.note_id);
  if (!note || note.is_folder) return null;
  if (note.is_dm_only && !admin && !isDMOfFolder(point.folder_id, uid)) return null;
  return {
    ...base,
    is_placeholder: false,
    note_title: note.title,
    note_category: note.category,
    display_label: point.label_override || note.title || 'Untitled',
    time_label: point.time_label || '',
  };
}

/**
 * GET /timeline?folder_id= — axis boxes for a campaign.
 */
router.get('/', authenticateToken, (req, res) => {
  const fid = req.query.folder_id ? parseInt(req.query.folder_id, 10) : null;
  const uid = req.user.id;
  const admin = isAdmin(uid);

  if (!fid || !Number.isFinite(fid)) {
    return res.status(400).json({ error: 'folder_id is required' });
  }

  const folder = db.prepare('SELECT id, is_folder, deleted_at FROM notes WHERE id = ?').get(fid);
  if (!folder || folder.deleted_at || !folder.is_folder) {
    return res.status(404).json({ error: 'Campaign folder not found' });
  }

  if (!canAccessFolder(uid, fid, admin)) {
    return res.json({ points: [], can_edit: false });
  }

  const rawPoints = db.prepare(`
    SELECT * FROM timeline_points
    WHERE folder_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(fid);

  const points = rawPoints.map((p) => enrichBox(p, uid, admin)).filter(Boolean);

  res.json({
    points,
    can_edit: canEditTimeline(uid, fid, admin) && !isNoteUnderCompletedArchive(fid),
  });
});

/**
 * POST /timeline/blocks — create a block (DM/admin).
 * Body: { folder_id, title?, width_weight? }
 */
router.post('/blocks', authenticateToken, (req, res) => {
  const { folder_id, title = '', width_weight = 1 } = req.body;
  const fid = folder_id ? parseInt(folder_id, 10) : null;
  if (!fid || !Number.isFinite(fid)) return res.status(400).json({ error: 'folder_id is required' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, fid, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, fid)) return;
  if (timelineDemoReadonlyOr403(req, res, fid)) return;

  const last = db.prepare('SELECT sort_order FROM timeline_blocks WHERE folder_id = ? ORDER BY sort_order DESC LIMIT 1').get(fid);
  const sort_order = (last?.sort_order ?? 0) + 1;
  const weight = Number.isFinite(Number(width_weight)) ? Math.max(0.25, Number(width_weight)) : 1;

  const result = db.prepare(`
    INSERT INTO timeline_blocks (folder_id, title, sort_order, width_weight, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(fid, String(title).slice(0, 200), sort_order, weight, uid);

  const block = db.prepare('SELECT * FROM timeline_blocks WHERE id = ?').get(result.lastInsertRowid);
  broadcastTimelineChanged(req.app, fid);
  res.status(201).json(block);
});

/**
 * PUT /timeline/blocks/:id — update block title, sort_order, or width_weight.
 */
router.put('/blocks/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const block = db.prepare('SELECT * FROM timeline_blocks WHERE id = ?').get(id);
  if (!block) return res.status(404).json({ error: 'Block not found' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, block.folder_id, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, block.folder_id)) return;
  if (timelineDemoReadonlyOr403(req, res, block.folder_id)) return;

  const { title, sort_order, width_weight } = req.body;
  const updates = [];
  const params = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(String(title).slice(0, 200)); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(Number(sort_order)); }
  if (width_weight !== undefined) {
    updates.push('width_weight = ?');
    params.push(Math.max(0.25, Number(width_weight) || 1));
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE timeline_blocks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM timeline_blocks WHERE id = ?').get(id);
  broadcastTimelineChanged(req.app, block.folder_id);
  res.json(updated);
});

/**
 * DELETE /timeline/blocks/:id — remove block; points keep folder_id with block_id set null.
 */
router.delete('/blocks/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const block = db.prepare('SELECT * FROM timeline_blocks WHERE id = ?').get(id);
  if (!block) return res.status(404).json({ error: 'Block not found' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, block.folder_id, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, block.folder_id)) return;
  if (timelineDemoReadonlyOr403(req, res, block.folder_id)) return;

  db.prepare('UPDATE timeline_points SET block_id = NULL WHERE block_id = ?').run(id);
  db.prepare('DELETE FROM timeline_blocks WHERE id = ?').run(id);
  broadcastTimelineChanged(req.app, block.folder_id);
  res.json({ ok: true });
});

/**
 * POST /timeline/points — create a box on the axis (DM/admin). note_id optional.
 * Body: { folder_id, anchor_x, end_x, end_y, path_json?, note_id? }
 */
router.post('/points', authenticateToken, (req, res) => {
  const {
    folder_id,
    anchor_x,
    end_x,
    end_y,
    path_json = null,
    note_id = null,
  } = req.body;
  const fid = folder_id ? parseInt(folder_id, 10) : null;
  const nid = note_id != null && note_id !== '' ? parseInt(note_id, 10) : null;
  if (!fid) return res.status(400).json({ error: 'folder_id is required' });

  const ax = Number(anchor_x);
  const ex = Number(end_x);
  const ey = Number(end_y);
  if (!Number.isFinite(ax) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
    return res.status(400).json({ error: 'anchor_x, end_x, and end_y are required' });
  }

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, fid, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, fid)) return;
  if (timelineDemoReadonlyOr403(req, res, fid)) return;

  if (nid != null) {
    if (!noteUnderFolder(nid, fid)) {
      return res.status(400).json({ error: 'Note must belong to this campaign' });
    }
    const note = db.prepare('SELECT id, is_folder, deleted_at FROM notes WHERE id = ?').get(nid);
    if (!note || note.deleted_at || note.is_folder) {
      return res.status(400).json({ error: 'Invalid note' });
    }
    const existing = db.prepare('SELECT id FROM timeline_points WHERE folder_id = ? AND note_id = ?').get(fid, nid);
    if (existing) return res.status(409).json({ error: 'Note is already on this timeline' });
  }

  const pathStr = path_json != null ? String(path_json) : null;
  const sort_order = ax;

  const result = db.prepare(`
    INSERT INTO timeline_points (
      folder_id, block_id, note_id, anchor_x, end_x, end_y, path_json,
      sort_order, time_label, label_override, created_by
    )
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '', NULL, ?)
  `).run(fid, nid, ax, ex, ey, pathStr, sort_order, uid);

  const point = db.prepare('SELECT * FROM timeline_points WHERE id = ?').get(result.lastInsertRowid);
  const enriched = enrichBox(point, uid, admin);
  broadcastTimelineChanged(req.app, fid);
  res.status(201).json(enriched);
});

/**
 * PUT /timeline/points/:id — assign note, or update geometry / labels.
 */
router.put('/points/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const point = db.prepare('SELECT * FROM timeline_points WHERE id = ?').get(id);
  if (!point) return res.status(404).json({ error: 'Point not found' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, point.folder_id, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, point.folder_id)) return;
  if (timelineDemoReadonlyOr403(req, res, point.folder_id)) return;

  const {
    note_id,
    time_label,
    label_override,
    sort_order,
    anchor_x,
    end_x,
    end_y,
    path_json,
  } = req.body;
  const updates = [];
  const params = [];

  if (note_id !== undefined) {
    if (note_id === null) {
      updates.push('note_id = NULL');
    } else {
      const nid = parseInt(note_id, 10);
      if (!noteUnderFolder(nid, point.folder_id)) {
        return res.status(400).json({ error: 'Note must belong to this campaign' });
      }
      const note = db.prepare('SELECT id, is_folder, deleted_at FROM notes WHERE id = ?').get(nid);
      if (!note || note.deleted_at || note.is_folder) {
        return res.status(400).json({ error: 'Invalid note' });
      }
      const existing = db.prepare(
        'SELECT id FROM timeline_points WHERE folder_id = ? AND note_id = ? AND id != ?'
      ).get(point.folder_id, nid, id);
      if (existing) return res.status(409).json({ error: 'Note is already on this timeline' });
      updates.push('note_id = ?');
      params.push(nid);
    }
  }
  if (time_label !== undefined) {
    updates.push('time_label = ?');
    params.push(String(time_label).slice(0, 200));
  }
  if (label_override !== undefined) {
    updates.push('label_override = ?');
    params.push(label_override ? String(label_override).slice(0, 200) : null);
  }
  if (sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(Number(sort_order));
  }
  if (anchor_x !== undefined) {
    updates.push('anchor_x = ?');
    params.push(Number(anchor_x));
  }
  if (end_x !== undefined) {
    updates.push('end_x = ?');
    params.push(Number(end_x));
  }
  if (end_y !== undefined) {
    updates.push('end_y = ?');
    params.push(Number(end_y));
  }
  if (path_json !== undefined) {
    updates.push('path_json = ?');
    params.push(path_json != null ? String(path_json) : null);
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE timeline_points SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM timeline_points WHERE id = ?').get(id);
  const enriched = enrichBox(updated, uid, admin);
  broadcastTimelineChanged(req.app, point.folder_id);
  res.json(enriched);
});

/**
 * DELETE /timeline/points/:id — remove a note pin from the timeline.
 */
router.delete('/points/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const point = db.prepare('SELECT * FROM timeline_points WHERE id = ?').get(id);
  if (!point) return res.status(404).json({ error: 'Point not found' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canEditTimeline(uid, point.folder_id, admin)) return res.status(403).json({ error: 'Only DMs can edit the timeline' });
  if (timelineArchivedOr403(req, res, point.folder_id)) return;
  if (timelineDemoReadonlyOr403(req, res, point.folder_id)) return;

  db.prepare('DELETE FROM timeline_points WHERE id = ?').run(id);
  broadcastTimelineChanged(req.app, point.folder_id);
  res.json({ ok: true });
});

module.exports = router;
