import api from '../api.js';

const STORAGE_KEY = 'chronicler_ddb_cobalt';
const USER_ID_KEY = 'chronicler_ddb_user_id';

/**
 * Returns the saved D&D Beyond CobaltSession from localStorage (browser-only; survives Chronicler logout).
 * @returns {string}
 */
export function getCobalt() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Returns the saved D&D Beyond account id (optional; helps load "My characters" list).
 * @returns {string}
 */
export function getDdbUserId() {
  try {
    return localStorage.getItem(USER_ID_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Persists CobaltSession on this device only.
 * @param {string} value
 * @returns {void}
 */
export function setCobalt(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value || '').trim());
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Persists account id on this device only when auto-resolved from D&D Beyond (optional; helps character list).
 * @param {string} value
 * @returns {void}
 */
export function setDdbUserId(value) {
  try {
    const v = String(value || '').trim();
    if (v) localStorage.setItem(USER_ID_KEY, v);
    else localStorage.removeItem(USER_ID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Removes saved D&D Beyond credentials from this device.
 * @returns {void}
 */
export function clearCobalt() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_ID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when a non-empty cobalt cookie is stored locally.
 * @returns {boolean}
 */
export function hasCobalt() {
  return getCobalt().length > 0;
}

/**
 * Merges cobalt and optional user_id into a POST body when saved locally.
 * @param {object} [body]
 * @returns {object}
 */
export function bodyWithCobalt(body = {}) {
  const out = { ...body };
  const cobalt = getCobalt();
  if (cobalt) out.cobalt = cobalt;
  const userId = getDdbUserId();
  if (userId) out.user_id = userId;
  return out;
}

/**
 * POST to /api/ddb/* with optional cobalt and user_id from localStorage merged into the JSON body.
 * @param {string} path - Path under /ddb (e.g. '/import')
 * @param {object} [body]
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export function ddbPost(path, body = {}) {
  return api.post(`/ddb${path}`, bodyWithCobalt(body));
}

/**
 * Parses a D&D Beyond character URL or numeric id.
 * @param {string} input
 * @returns {number|null}
 */
export function parseCharacterIdFromInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/characters\/(\d+)/i) || s.match(/^(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * True when a Chronicler note is linked to a D&D Beyond character import.
 * @param {object|null|undefined} note
 * @returns {boolean}
 */
export function isDdbLinkedNote(note) {
  if (!note) return false;
  if (note.ddb_character_id) return true;
  if (Array.isArray(note.tags) && note.tags.includes('dnd-beyond')) return true;
  return /<!--\s*ddb-character-id:\s*\d+\s*-->/i.test(String(note.content || ''));
}
