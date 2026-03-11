const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOf } = require('../utils/access');

const router = express.Router();

// GET all connections — only where BOTH notes are visible to the user
router.get('/', authenticateToken, (req, res) => {
  const uid   = req.user.id;
  const admin = isAdmin(uid);

  let connections;
  if (admin) {
    connections = db.prepare(`
      SELECT c.*, sn.title AS source_title, tn.title AS target_title
      FROM connections c
      JOIN notes sn ON c.source_note_id = sn.id
      JOIN notes tn ON c.target_note_id = tn.id
    `).all();
  } else {
    connections = db.prepare(`
      SELECT c.*, sn.title AS source_title, tn.title AS target_title
      FROM connections c
      JOIN notes sn ON c.source_note_id = sn.id
      JOIN notes tn ON c.target_note_id = tn.id
      WHERE (sn.user_id = ? OR sn.visibility = 'shared'
             OR EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = sn.id AND np.user_id = ?))
        AND (tn.user_id = ? OR tn.visibility = 'shared'
             OR EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = tn.id AND np.user_id = ?))
    `).all(uid, uid, uid, uid);
  }

  res.json(connections);
});

// POST create a connection
router.post('/', authenticateToken, (req, res) => {
  const { source_note_id, target_note_id, label = '' } = req.body;
  if (!source_note_id || !target_note_id)
    return res.status(400).json({ error: 'source_note_id and target_note_id are required' });
  if (source_note_id === target_note_id)
    return res.status(400).json({ error: 'A note cannot connect to itself' });

  try {
    const result = db.prepare(
      'INSERT INTO connections (source_note_id, target_note_id, label, created_by) VALUES (?, ?, ?, ?)'
    ).run(source_note_id, target_note_id, label, req.user.id);

    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(result.lastInsertRowid);
    if (req.app.broadcast) req.app.broadcast({ type: 'connections_changed' });
    res.status(201).json(conn);
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'These notes are already connected' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update label — owner, DM, or admin
router.put('/:id', authenticateToken, (req, res) => {
  const { label = '' } = req.body;
  const admin = isAdmin(req.user.id);
  const conn  = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  const isCreator = conn.created_by === req.user.id;
  const isDM = isDMOf(conn.source_note_id, req.user.id) || isDMOf(conn.target_note_id, req.user.id);
  if (!admin && !isCreator && !isDM) return res.status(403).json({ error: 'Not authorised' });
  db.prepare('UPDATE connections SET label = ? WHERE id = ?').run(label, req.params.id);
  const updated = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
  if (req.app.broadcast) req.app.broadcast({ type: 'connections_changed' });
  res.json(updated);
});

// DELETE — owner, DM, or admin
router.delete('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const conn  = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  const isCreator = conn.created_by === req.user.id;
  const isDM = isDMOf(conn.source_note_id, req.user.id) || isDMOf(conn.target_note_id, req.user.id);
  if (!admin && !isCreator && !isDM) return res.status(403).json({ error: 'Not authorised' });
  db.prepare('DELETE FROM connections WHERE id = ?').run(req.params.id);
  if (req.app.broadcast) req.app.broadcast({ type: 'connections_changed' });
  res.json({ success: true });
});

module.exports = router;
