const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isNoteUnderCompletedArchive } = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');
const {
  testCobalt,
  listCharacters,
  fetchCharacter,
  parseCharacterId,
} = require('../utils/ddbClient');
const { characterToMarkdown } = require('../utils/ddbCharacterToMarkdown');

const router = express.Router();

/** @type {Map<number, { count: number, resetAt: number }>} */
const rateByUser = new Map();

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Increments per-user DDB upstream call counter; throws when over limit.
 * @param {number} userId
 * @returns {void}
 */
function assertRateLimit(userId) {
  const now = Date.now();
  let bucket = rateByUser.get(userId);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateByUser.set(userId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) {
    const err = new Error('Too many D&D Beyond requests. Try again in an hour.');
    err.status = 429;
    throw err;
  }
}

/**
 * Replaces note tags for a note id (same rules as notes route).
 * @param {number} noteId
 * @param {string[]} tags
 * @returns {void}
 */
function saveTags(noteId, tags) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insert = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)');
  const insertAll = db.transaction((ts) => ts.forEach((t) => {
    const clean = String(t).replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-');
    if (clean) insert.run(noteId, clean);
  }));
  insertAll(tags || []);
}

/**
 * Attaches tags and granted_users to a note row for API responses.
 * @param {object} note
 * @returns {object}
 */
function withTagsAndPerms(note) {
  if (!note) return note;
  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(note.id).map((r) => r.tag);
  const granted = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(note.id).map((r) => r.user_id);
  return { ...note, tags, granted_users: granted };
}

/**
 * Validates parent folder and returns parent row for note creation.
 * @param {number} userId
 * @param {number} parentId
 * @returns {object}
 */
function validateImportParent(userId, parentId) {
  const admin = isAdmin(userId);
  const pid = parseInt(parentId, 10);
  if (!Number.isFinite(pid)) {
    const err = new Error('parent_id is required');
    err.status = 400;
    throw err;
  }

  const parent = db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(pid);
  if (!parent) {
    const err = new Error('Parent folder not found');
    err.status = 404;
    throw err;
  }
  if (!parent.is_folder) {
    const err = new Error('parent_id must be a folder');
    err.status = 400;
    throw err;
  }

  const demoErr = demoMutateForbiddenMessage(userId, pid);
  if (demoErr) {
    const err = new Error(demoErr);
    err.status = 403;
    throw err;
  }
  if (isNoteUnderCompletedArchive(pid) && !admin) {
    const err = new Error('This campaign or world is marked completed; creating notes is disabled.');
    err.status = 403;
    throw err;
  }

  return parent;
}

/**
 * Creates an npc note under parent_id with inherited visibility and grants.
 * @param {number} userId
 * @param {number} parentId
 * @param {string} title
 * @param {string} content
 * @param {string[]} tags
 * @returns {object}
 */
function createImportedNote(userId, parentId, title, content, tags) {
  const parent = validateImportParent(userId, parentId);
  const visibility = parent.visibility || 'hidden';
  const inheritedGrants = db
    .prepare('SELECT user_id FROM note_permissions WHERE note_id = ?')
    .all(parentId)
    .map((r) => r.user_id);

  const result = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order, visibility, is_world)
    VALUES (?, ?, ?, ?, 0, 0, 'npc', '', 0, ?, 0)
  `).run(userId, parentId, title.trim(), content, visibility);

  const noteId = result.lastInsertRowid;
  saveTags(noteId, tags);

  const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
  const grantAll = db.transaction((grants) => grants.forEach((uid) => grantInsert.run(noteId, uid)));
  grantAll(inheritedGrants);

  return db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
}

/**
 * Maps upstream/client errors to HTTP responses (never logs cobalt).
 * @param {Error & { code?: string, status?: number }} err
 * @param {import('express').Response} res
 * @returns {import('express').Response|null}
 */
function sendDdbError(err, res) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'DDB_AUTH' || err.code === 'DDB_NO_COBALT') {
    return res.status(422).json({ error: err.message, ddb: true });
  }
  if (err.code === 'DDB_FORBIDDEN') {
    return res.status(403).json({ error: err.message });
  }
  if (err.code === 'DDB_NOT_FOUND' || err.code === 'DDB_BAD_ID') {
    return res.status(404).json({ error: err.message });
  }
  if (err.code === 'DDB_UPSTREAM') {
    return res.status(502).json({ error: err.message });
  }
  return null;
}

/** POST /auth/test — validate cobalt cookie (not stored server-side). */
router.post('/auth/test', authenticateToken, async (req, res) => {
  try {
    assertRateLimit(req.user.id);
    const cobalt = String(req.body?.cobalt || '').trim();
    if (!cobalt) return res.status(400).json({ error: 'cobalt is required' });
    const userId = req.body?.user_id ?? req.body?.userId ?? null;
    const result = await testCobalt(cobalt, userId);
    return res.json(result);
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb auth/test:', err.message);
    return res.status(500).json({ error: 'D&D Beyond connection failed' });
  }
});

/** POST /characters/list — list account characters (requires cobalt in body). */
router.post('/characters/list', authenticateToken, async (req, res) => {
  try {
    assertRateLimit(req.user.id);
    const cobalt = String(req.body?.cobalt || '').trim();
    if (!cobalt) return res.status(400).json({ error: 'cobalt is required' });
    const userId = req.body?.user_id ?? req.body?.userId ?? null;
    const characters = await listCharacters(cobalt, userId);
    return res.json({ characters });
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb characters/list:', err.message);
    return res.status(500).json({ error: 'Failed to list characters' });
  }
});

/** POST /character/fetch — preview markdown for a character id. */
router.post('/character/fetch', authenticateToken, async (req, res) => {
  try {
    assertRateLimit(req.user.id);
    const cobalt = req.body?.cobalt ? String(req.body.cobalt).trim() : '';
    const characterId = parseCharacterId(req.body?.character_id ?? req.body?.characterId ?? req.body?.url);
    if (!characterId) return res.status(400).json({ error: 'character_id or character URL is required' });

    const data = await fetchCharacter(cobalt, characterId);
    const preview = characterToMarkdown(data);
    return res.json({ character_id: characterId, ...preview });
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb character/fetch:', err.message);
    return res.status(500).json({ error: 'Failed to fetch character' });
  }
});

/** POST /import — fetch character and create a new note under parent_id. */
router.post('/import', authenticateToken, async (req, res) => {
  try {
    assertRateLimit(req.user.id);
    const cobalt = req.body?.cobalt ? String(req.body.cobalt).trim() : '';
    const characterId = parseCharacterId(req.body?.character_id ?? req.body?.characterId ?? req.body?.url);
    const parentId = req.body?.parent_id;

    if (!characterId) return res.status(400).json({ error: 'character_id or character URL is required' });
    if (parentId == null) return res.status(400).json({ error: 'parent_id is required' });

    const data = await fetchCharacter(cobalt, characterId);
    const { title, content, tags } = characterToMarkdown(data);
    const note = createImportedNote(req.user.id, parentId, title, content, tags);

    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return res.status(201).json(withTagsAndPerms(note));
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb import:', err.message);
    return res.status(500).json({ error: 'Import failed' });
  }
});

module.exports = router;
