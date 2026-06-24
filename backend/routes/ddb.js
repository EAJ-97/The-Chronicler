const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isGrantedUser, isNoteUnderCompletedArchive } = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');
const {
  testCobalt,
  listCharacters,
  fetchCharacter,
  parseCharacterId,
} = require('../utils/ddbClient');
const { characterToMarkdown } = require('../utils/ddbCharacterToMarkdown');
const { downloadCharacterAvatar } = require('../utils/ddbAvatar');
const {
  parseDdbCharacterId,
  isDdbLinkedNote,
  buildFlavorMarkdown,
  flavorHash,
  isNoteOnCooldown,
  recordNoteCheck,
  clearNoteCheckCooldown,
  compareFlavor,
  contentPreview,
} = require('../utils/ddbFlavorSync');

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
    err.code = 'DDB_RATE_LIMIT';
    throw err;
  }
}

/**
 * True when the user may view the note (mirrors notes route canSee).
 * @param {number} noteId
 * @param {number} userId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canSeeNote(noteId, userId, admin) {
  if (admin) return true;
  const note = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(noteId);
  if (!note) return false;
  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;
  return isGrantedUser(noteId, userId);
}

/**
 * True when the user may fully edit note content (mirrors notes PUT canFullEdit).
 * @param {object} note
 * @param {number} userId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canFullEditNote(note, userId, admin) {
  if (admin) return true;
  if (note.user_id === userId) return true;
  return isGrantedUser(note.id, userId);
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
 * Creates an npc note under parent_id with inherited visibility, grants, and optional DDB link metadata.
 * @param {number} userId
 * @param {number} parentId
 * @param {string} title
 * @param {string} content
 * @param {string[]} tags
 * @param {{ displayIcon?: string|null, characterId?: number|null, flavorHashValue?: string|null }} [ddbMeta]
 * @returns {object}
 */
function createImportedNote(userId, parentId, title, content, tags, ddbMeta = {}) {
  const parent = validateImportParent(userId, parentId);
  const visibility = parent.visibility || 'hidden';
  const inheritedGrants = db
    .prepare('SELECT user_id FROM note_permissions WHERE note_id = ?')
    .all(parentId)
    .map((r) => r.user_id);

  const displayIcon = ddbMeta.displayIcon || null;
  const characterId = ddbMeta.characterId ?? null;
  const hash = ddbMeta.flavorHashValue ?? null;
  const syncedAt = hash ? new Date().toISOString() : null;

  const result = db.prepare(`
    INSERT INTO notes (
      user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order,
      visibility, is_world, display_icon, ddb_character_id, ddb_flavor_hash, ddb_flavor_synced_at
    )
    VALUES (?, ?, ?, ?, 0, 0, 'npc', '', 0, ?, 0, ?, ?, ?, ?)
  `).run(
    userId,
    parentId,
    title.trim(),
    content,
    visibility,
    displayIcon,
    characterId,
    hash,
    syncedAt,
  );

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
  if (err.code === 'DDB_RATE_LIMIT' || err.status === 429) {
    return res.status(429).json({ error: err.message, ddb_status: 'rate_limited' });
  }
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'DDB_AUTH' || err.code === 'DDB_NO_COBALT') {
    return res.status(422).json({ error: err.message, ddb: true });
  }
  if (err.code === 'DDB_FORBIDDEN') {
    return res.status(403).json({ error: err.message, ddb_status: 'private' });
  }
  if (err.code === 'DDB_NOT_FOUND' || err.code === 'DDB_BAD_ID') {
    return res.status(404).json({ error: err.message, ddb_status: 'deleted' });
  }
  if (err.code === 'DDB_UPSTREAM') {
    return res.status(502).json({ error: err.message });
  }
  return null;
}

/**
 * Loads a note for DDB flavor operations; throws when missing or not linked.
 * @param {number} noteId
 * @returns {{ note: object, tags: string[] }}
 */
function loadLinkedNote(noteId) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) {
    const err = new Error('Note not found');
    err.status = 404;
    throw err;
  }
  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(noteId).map((r) => r.tag);
  if (!isDdbLinkedNote(note, tags)) {
    const err = new Error('This note is not linked to D&D Beyond');
    err.status = 400;
    throw err;
  }
  const characterId = parseDdbCharacterId(note);
  if (!characterId) {
    const err = new Error('D&D Beyond character id not found on this note');
    err.status = 400;
    throw err;
  }
  return { note, tags, characterId };
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
    const displayIcon = await downloadCharacterAvatar(data);
    const hash = flavorHash(content);

    const note = createImportedNote(req.user.id, parentId, title, content, tags, {
      displayIcon,
      characterId,
      flavorHashValue: hash,
    });

    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return res.status(201).json(withTagsAndPerms(note));
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb import:', err.message);
    return res.status(500).json({ error: 'Import failed' });
  }
});

/** POST /flavor/check — compare stored flavor with live D&D Beyond (notify-only; no mutation). */
router.post('/flavor/check', authenticateToken, async (req, res) => {
  try {
    const noteId = parseInt(req.body?.note_id ?? req.body?.noteId, 10);
    if (!Number.isFinite(noteId)) return res.status(400).json({ error: 'note_id is required' });

    const admin = isAdmin(req.user.id);
    if (!canSeeNote(noteId, req.user.id, admin)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { note, characterId } = loadLinkedNote(noteId);

    const force = req.body?.force === true || req.body?.force === 1 || req.body?.force === '1';
    if (force) clearNoteCheckCooldown(req.user.id, noteId);

    if (!force && isNoteOnCooldown(req.user.id, noteId)) {
      return res.json({
        has_updates: false,
        ddb_status: 'cooldown',
        checked_at: new Date().toISOString(),
      });
    }

    assertRateLimit(req.user.id);
    const cobalt = req.body?.cobalt ? String(req.body.cobalt).trim() : '';

    let data;
    try {
      data = await fetchCharacter(cobalt, characterId);
    } catch (err) {
      recordNoteCheck(req.user.id, noteId);
      if (err.code === 'DDB_NOT_FOUND') {
        return res.json({
          has_updates: false,
          ddb_status: 'deleted',
          checked_at: new Date().toISOString(),
        });
      }
      if (err.code === 'DDB_FORBIDDEN') {
        return res.json({
          has_updates: false,
          ddb_status: 'private',
          error: err.message,
          checked_at: new Date().toISOString(),
        });
      }
      throw err;
    }

    recordNoteCheck(req.user.id, noteId);
    const fresh = buildFlavorMarkdown(data);
    const comparison = compareFlavor(note, fresh);

    if (!comparison.has_updates && !note.ddb_flavor_hash) {
      db.prepare(
        'UPDATE notes SET ddb_flavor_hash = ?, ddb_flavor_synced_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(comparison.fresh_hash, noteId);
    }

    return res.json({
      has_updates: comparison.has_updates,
      ddb_status: 'ok',
      title: fresh.title,
      content_preview: contentPreview(fresh.content),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb flavor/check:', err.message);
    return res.status(500).json({ error: 'Flavor check failed' });
  }
});

/** POST /flavor/apply — re-fetch D&D Beyond flavor and update note content (title only; not display_icon). */
router.post('/flavor/apply', authenticateToken, async (req, res) => {
  try {
    const noteId = parseInt(req.body?.note_id ?? req.body?.noteId, 10);
    if (!Number.isFinite(noteId)) return res.status(400).json({ error: 'note_id is required' });

    const admin = isAdmin(req.user.id);
    if (!canSeeNote(noteId, req.user.id, admin)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { note, characterId } = loadLinkedNote(noteId);

    if (!canFullEditNote(note, req.user.id, admin)) {
      return res.status(403).json({ error: 'You do not have permission to edit this note' });
    }

    if (isNoteUnderCompletedArchive(noteId) && !admin) {
      return res.status(403).json({
        error: 'This campaign or world is marked completed; content is read-only. A DM can clear completion on the root folder.',
      });
    }

    const demoErr = demoMutateForbiddenMessage(req.user.id, noteId);
    if (demoErr) return res.status(403).json({ error: demoErr });

    assertRateLimit(req.user.id);
    const cobalt = req.body?.cobalt ? String(req.body.cobalt).trim() : '';
    const data = await fetchCharacter(cobalt, characterId);
    const fresh = buildFlavorMarkdown(data);
    const hash = flavorHash(fresh.content);

    db.prepare(`
      UPDATE notes
      SET title = ?, content = ?, ddb_character_id = ?, ddb_flavor_hash = ?,
          ddb_flavor_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fresh.title, fresh.content, characterId, hash, noteId);

    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return res.json(withTagsAndPerms(updated));
  } catch (err) {
    const sent = sendDdbError(err, res);
    if (sent) return sent;
    console.error('ddb flavor/apply:', err.message);
    return res.status(500).json({ error: 'Flavor apply failed' });
  }
});

module.exports = router;
