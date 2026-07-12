'use strict';

/**
 * Demo tenancy helpers: targeted DM role sync on demo roots, outsider exclusion,
 * and read-only demo trees for non-admins. Used by demoSeeder, auth, admin, and API routes.
 */

const db = require('../db/database');
const { getRootFolderId, isAdmin } = require('./access');

/** Username with no world/campaign demo access (permission negative control). */
const DEMO_OUTSIDER_USERNAME = 'demo_outsider';

/**
 * Returns whether the Chronicler demo dataset flag is set in settings.
 * @returns {boolean}
 */
function isDemoSeeded() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get();
  return row?.value === 'true';
}

/**
 * True when the user is the designated demo outsider account.
 * @param {number} userId
 * @returns {boolean}
 */
function isDemoOutsider(userId) {
  if (!userId) return false;
  const row = db.prepare('SELECT username, is_demo FROM users WHERE id = ?').get(userId);
  return !!(row && row.is_demo && row.username === DEMO_OUTSIDER_USERNAME);
}

/**
 * Lists demo campaign folder roots that need DM sync (Sunken Vale only — not world layer).
 * @returns {number[]}
 */
function getDemoRootFolderIds() {
  const rows = db.prepare(`
    SELECT id FROM notes
    WHERE is_folder = 1 AND is_demo = 1 AND deleted_at IS NULL
      AND LOWER(TRIM(title)) = 'the sunken vale'
    ORDER BY id ASC
  `).all();
  return rows.map((r) => r.id);
}

/**
 * Ensures admins and existing demo DMs keep folder_roles on demo roots (idempotent).
 * Does not grant DM to all users — demo_outsider is always skipped.
 * @param {number} userId - User to sync
 * @returns {void}
 */
function syncDemoDmRolesForUser(userId) {
  if (!userId || !Number.isFinite(Number(userId))) return;
  if (isDemoOutsider(userId)) return;

  const uid = Number(userId);
  const roots = getDemoRootFolderIds();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')"
  );

  if (isAdmin(uid)) {
    for (const folderId of roots) {
      ins.run(folderId, uid);
    }
    return;
  }

  for (const folderId of roots) {
    const alreadyDm = db.prepare(
      "SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'"
    ).get(folderId, uid);
    if (alreadyDm) {
      ins.run(folderId, uid);
    }
  }
}

/**
 * Syncs DM roles for the seeding admin and demo_dm after generate (idempotent repair).
 * @param {number} adminUserId
 * @returns {void}
 */
function syncDemoDmRolesAfterSeed(adminUserId) {
  syncDemoDmRolesForUser(adminUserId);
  const demoDm = db.prepare('SELECT id FROM users WHERE username = ?').get('demo_dm');
  if (demoDm) syncDemoDmRolesForUser(demoDm.id);
}

/**
 * @deprecated Use syncDemoDmRolesAfterSeed — kept for callers that still import the name.
 * @returns {void}
 */
function syncDemoDmRolesForAllUsers() {
  const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').get();
  if (admin) syncDemoDmRolesAfterSeed(admin.id);
}

/**
 * True when the note lives under a demo campaign/world root (root row has is_demo = 1).
 * @param {number|null|undefined} noteId
 * @returns {boolean}
 */
function isUnderDemoCampaign(noteId) {
  if (noteId == null || !Number.isFinite(Number(noteId))) return false;
  const rootId = getRootFolderId(Number(noteId));
  if (!rootId) return false;
  const root = db.prepare('SELECT is_demo FROM notes WHERE id = ? AND deleted_at IS NULL').get(rootId);
  return !!(root && root.is_demo);
}

/**
 * If the note is under a demo tree and the user is not an admin, returns an error message
 * for HTTP 403; otherwise null (mutation allowed).
 * @param {number} userId
 * @param {number|null|undefined} noteId
 * @returns {string|null}
 */
function demoMutateForbiddenMessage(userId, noteId) {
  if (!isUnderDemoCampaign(noteId)) return null;
  if (isAdmin(userId)) return null;
  return 'Demo content is read-only for non-admins.';
}

/**
 * Same as demoMutateForbiddenMessage but for a folder id used as journal campaign root.
 * @param {number} userId
 * @param {number|null|undefined} folderId
 * @returns {string|null}
 */
function demoFolderMutateForbiddenMessage(userId, folderId) {
  return demoMutateForbiddenMessage(userId, folderId);
}

/**
 * True if either endpoint note is under a demo campaign.
 * @param {number|null|undefined} sourceId
 * @param {number|null|undefined} targetId
 * @returns {boolean}
 */
function connectionTouchesDemo(sourceId, targetId) {
  return isUnderDemoCampaign(sourceId) || isUnderDemoCampaign(targetId);
}

/**
 * Returns forbidden message if any of the note ids touches demo and user is not admin.
 * @param {number} userId
 * @param {number[]} noteIds
 * @returns {string|null}
 */
function demoMutateForbiddenForAny(userId, noteIds) {
  for (const id of noteIds) {
    const msg = demoMutateForbiddenMessage(userId, id);
    if (msg) return msg;
  }
  return null;
}

module.exports = {
  DEMO_OUTSIDER_USERNAME,
  isDemoSeeded,
  isDemoOutsider,
  getDemoRootFolderIds,
  syncDemoDmRolesForUser,
  syncDemoDmRolesAfterSeed,
  syncDemoDmRolesForAllUsers,
  isUnderDemoCampaign,
  demoMutateForbiddenMessage,
  demoFolderMutateForbiddenMessage,
  connectionTouchesDemo,
  demoMutateForbiddenForAny,
};
