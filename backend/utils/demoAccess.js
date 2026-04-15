'use strict';

/**
 * Demo tenancy helpers: sync DM roles on demo roots for all users, and enforce
 * read-only demo trees for non-admins. Used by demoSeeder, auth, admin, and API routes.
 */

const db = require('../db/database');
const { getRootFolderId, isAdmin } = require('./access');

/**
 * Returns whether the Chronicler demo dataset flag is set in settings.
 * @returns {boolean}
 */
function isDemoSeeded() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get();
  return row?.value === 'true';
}

/**
 * Lists top-level folder note ids that belong to the demo dataset (campaign roots).
 * @returns {number[]}
 */
function getDemoRootFolderIds() {
  const rows = db.prepare(`
    SELECT id FROM notes
    WHERE parent_id IS NULL AND is_folder = 1 AND is_demo = 1 AND deleted_at IS NULL
    ORDER BY id ASC
  `).all();
  return rows.map((r) => r.id);
}

/**
 * Ensures the given user has folder_roles DM on every demo root folder (idempotent).
 * @param {number} userId - User to grant DM on demo roots
 * @returns {void}
 */
function syncDemoDmRolesForUser(userId) {
  if (!userId || !Number.isFinite(Number(userId))) return;
  const uid = Number(userId);
  const roots = getDemoRootFolderIds();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')"
  );
  for (const folderId of roots) {
    ins.run(folderId, uid);
  }
}

/**
 * Grants every existing user DM on all demo root folders (idempotent). Call after
 * demo generate and optionally on login/repair.
 * @returns {void}
 */
function syncDemoDmRolesForAllUsers() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const { id } of users) {
    syncDemoDmRolesForUser(id);
  }
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
  isDemoSeeded,
  getDemoRootFolderIds,
  syncDemoDmRolesForUser,
  syncDemoDmRolesForAllUsers,
  isUnderDemoCampaign,
  demoMutateForbiddenMessage,
  demoFolderMutateForbiddenMessage,
  connectionTouchesDemo,
  demoMutateForbiddenForAny,
};
