const crypto = require('crypto');
const { characterToMarkdown, flavorHashInput } = require('./ddbCharacterToMarkdown');

/** Per-note flavor check cooldown (ms). */
const NOTE_COOLDOWN_MS = 15 * 60 * 1000;

/** @type {Map<string, number>} key = `${userId}:${noteId}` → last check timestamp */
const lastCheckByNote = new Map();

const DDB_CHARACTER_ID_RE = /<!--\s*ddb-character-id:\s*(\d+)\s*-->/i;

/**
 * Parses linked D&D Beyond character id from note row or markdown comment.
 * @param {{ ddb_character_id?: number|null, content?: string }} note
 * @returns {number|null}
 */
function parseDdbCharacterId(note) {
  const col = note?.ddb_character_id;
  if (col != null && Number.isFinite(Number(col)) && Number(col) > 0) {
    return parseInt(String(col), 10);
  }
  const m = String(note?.content || '').match(DDB_CHARACTER_ID_RE);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * True when the note is linked to D&D Beyond (column or dnd-beyond tag).
 * @param {object} note
 * @param {string[]} [tags]
 * @returns {boolean}
 */
function isDdbLinkedNote(note, tags) {
  if (parseDdbCharacterId(note)) return true;
  return Array.isArray(tags) && tags.includes('dnd-beyond');
}

/**
 * Builds flavor markdown payload from raw D&D Beyond character JSON.
 * @param {object} data
 * @returns {{ title: string, content: string, tags: string[], characterId: number|null }}
 */
function buildFlavorMarkdown(data) {
  const { title, content, tags } = characterToMarkdown(data);
  const characterId = parseInt(data?.id ?? data?.characterId, 10) || null;
  return { title, content, tags, characterId };
}

/**
 * SHA-256 hash of normalized flavor markdown content.
 * @param {string} content
 * @returns {string}
 */
function flavorHash(content) {
  return crypto.createHash('sha256').update(flavorHashInput(content), 'utf8').digest('hex');
}

/**
 * Returns true if this note/user pair is still within the per-note check cooldown.
 * @param {number} userId
 * @param {number} noteId
 * @returns {boolean}
 */
function isNoteOnCooldown(userId, noteId) {
  const key = `${userId}:${noteId}`;
  const last = lastCheckByNote.get(key);
  if (!last) return false;
  return Date.now() - last < NOTE_COOLDOWN_MS;
}

/**
 * Records a flavor check timestamp for cooldown tracking.
 * @param {number} userId
 * @param {number} noteId
 * @returns {void}
 */
function recordNoteCheck(userId, noteId) {
  lastCheckByNote.set(`${userId}:${noteId}`, Date.now());
}

/**
 * Clears per-note flavor check cooldown so the next check hits D&D Beyond.
 * @param {number} userId
 * @param {number} noteId
 * @returns {void}
 */
function clearNoteCheckCooldown(userId, noteId) {
  lastCheckByNote.delete(`${userId}:${noteId}`);
}

/**
 * Compares stored note flavor with fresh D&D Beyond markdown (content hash and title).
 * @param {object} note - Note row with content and ddb_flavor_hash
 * @param {{ title: string, content: string }} fresh
 * @returns {{ has_updates: boolean, fresh_hash: string, stored_hash: string }}
 */
function compareFlavor(note, fresh) {
  const freshHash = flavorHash(fresh.content);
  const storedHash = note.ddb_flavor_hash || flavorHash(note.content || '');
  const titleChanged = String(note.title || '').trim() !== String(fresh.title || '').trim();
  return {
    has_updates: freshHash !== storedHash || titleChanged,
    fresh_hash: freshHash,
    stored_hash: storedHash,
  };
}

/**
 * Truncates content for API preview responses.
 * @param {string} content
 * @param {number} [maxLen]
 * @returns {string}
 */
function contentPreview(content, maxLen = 400) {
  const s = String(content || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

module.exports = {
  NOTE_COOLDOWN_MS,
  parseDdbCharacterId,
  isDdbLinkedNote,
  buildFlavorMarkdown,
  flavorHash,
  isNoteOnCooldown,
  recordNoteCheck,
  clearNoteCheckCooldown,
  compareFlavor,
  contentPreview,
};
