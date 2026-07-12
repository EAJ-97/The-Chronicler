/**
 * Campaign and world roster helpers: scoped subtrees, selective member grants,
 * and world-member grant snapshots for remove/re-add.
 */

const db = require('../db/database');
const { isWorldMember, isPlayableCampaignRoot, getWorldParentForCampaign } = require('./access');

/**
 * @typedef {'world'|'campaign'} ScopeMode
 */

/**
 * Loads a scope root folder row or null.
 * @param {number} scopeFolderId
 * @returns {object|null}
 */
function getScopeFolder(scopeFolderId) {
  return db.prepare(
    'SELECT id, user_id, parent_id, is_folder, is_world, deleted_at FROM notes WHERE id = ? AND deleted_at IS NULL'
  ).get(scopeFolderId);
}

/**
 * Resolves whether a scope folder is a world root or a campaign root.
 * @param {object} folder
 * @returns {ScopeMode}
 */
function getScopeMode(folder) {
  if (folder?.is_world && !folder.parent_id) return 'world';
  return 'campaign';
}

/**
 * Returns user ids on the roster for a world or campaign scope root (owner + grants + DMs).
 * @param {number} scopeFolderId
 * @returns {number[]}
 */
function getRosterUserIds(scopeFolderId) {
  const folder = getScopeFolder(scopeFolderId);
  if (!folder) return [];

  const ids = new Set();
  if (folder.user_id) ids.add(folder.user_id);

  db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(scopeFolderId)
    .forEach((r) => ids.add(r.user_id));

  if (getScopeMode(folder) !== 'world') {
    db.prepare("SELECT user_id FROM folder_roles WHERE folder_id = ? AND role = 'dm'").all(scopeFolderId)
      .forEach((r) => ids.add(r.user_id));
  }

  return [...ids];
}

/**
 * Collects note ids within a scope without crossing campaign boundaries under a world.
 * @param {number} scopeFolderId
 * @param {ScopeMode} mode
 * @returns {number[]}
 */
function collectScopedNoteIds(scopeFolderId, mode) {
  const folder = getScopeFolder(scopeFolderId);
  if (!folder) return [];

  const ids = [];
  const queue = [scopeFolderId];

  while (queue.length) {
    const pid = queue.shift();
    ids.push(pid);

    const children = db.prepare(
      'SELECT id, is_folder FROM notes WHERE parent_id = ? AND deleted_at IS NULL'
    ).all(pid);

    for (const child of children) {
      // World scope stops at campaign boundaries — campaigns are separate rosters.
      if (mode === 'world' && pid === scopeFolderId && child.is_folder && isPlayableCampaignRoot(child.id)) {
        continue;
      }
      queue.push(child.id);
    }
  }

  return ids;
}

/**
 * Whether a roster member can see a note using player list rules (no DM boost, no roster-only inheritance).
 * @param {number} noteId
 * @param {number} userId
 * @param {number} scopeFolderId
 * @returns {boolean}
 */
function canMemberSeeNote(noteId, userId, scopeFolderId) {
  const note = db.prepare(
    'SELECT id, user_id, parent_id, visibility, is_folder, is_dm_only, deleted_at FROM notes WHERE id = ?'
  ).get(noteId);
  if (!note || note.deleted_at) return false;
  if (note.is_dm_only) return false;

  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;

  const directGrant = db.prepare(
    'SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?'
  ).get(noteId, userId);
  if (!directGrant) return false;

  return canAccessAncestorsForMember(note, userId, scopeFolderId);
}

/**
 * Walks ancestors up to the scope root; hidden folders without grant block access.
 * @param {object} note
 * @param {number} userId
 * @param {number} scopeFolderId
 * @returns {boolean}
 */
function canAccessAncestorsForMember(note, userId, scopeFolderId) {
  let parentId = note.parent_id;
  while (parentId != null && parentId !== scopeFolderId) {
    const parent = db.prepare(
      'SELECT id, parent_id, user_id, visibility, is_folder FROM notes WHERE id = ? AND deleted_at IS NULL'
    ).get(parentId);
    if (!parent) break;

    if (parent.is_folder && parent.visibility === 'hidden' && parent.user_id !== userId) {
      const granted = db.prepare(
        'SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?'
      ).get(parent.id, userId);
      if (!granted) return false;
    }
    parentId = parent.parent_id;
  }
  return true;
}

/**
 * True when every roster member can see the note (player visibility rules).
 * @param {number} noteId
 * @param {number[]} rosterIds
 * @param {number} scopeFolderId
 * @returns {boolean}
 */
function isNoteVisibleToAllRosterMembers(noteId, rosterIds, scopeFolderId) {
  if (!rosterIds.length) return false;
  const note = db.prepare('SELECT is_dm_only FROM notes WHERE id = ?').get(noteId);
  if (!note || note.is_dm_only) return false;

  for (const uid of rosterIds) {
    if (!canMemberSeeNote(noteId, uid, scopeFolderId)) return false;
  }
  return true;
}

/**
 * Persists world-layer grants for a user so they can be restored on re-add.
 * @param {number} worldFolderId
 * @param {number} userId
 */
function snapshotWorldMemberGrants(worldFolderId, userId) {
  db.prepare(
    'DELETE FROM world_member_grant_snapshots WHERE world_folder_id = ? AND user_id = ?'
  ).run(worldFolderId, userId);

  const scopedIds = collectScopedNoteIds(worldFolderId, 'world');
  if (scopedIds.length === 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO world_member_grant_snapshots (world_folder_id, user_id, note_id) VALUES (?, ?, ?)'
  );

  const placeholders = scopedIds.map(() => '?').join(',');
  const grantRows = db.prepare(
    `SELECT note_id FROM note_permissions WHERE user_id = ? AND note_id IN (${placeholders})`
  ).all(userId, ...scopedIds);

  const tx = db.transaction(() => {
    for (const row of grantRows) {
      insert.run(worldFolderId, userId, row.note_id);
    }
  });
  tx();
}

/**
 * Restores prior world-layer grants from snapshot after re-adding a world member.
 * @param {number} worldFolderId
 * @param {number} userId
 */
function restoreWorldMemberGrants(worldFolderId, userId) {
  const rows = db.prepare(
    'SELECT note_id FROM world_member_grant_snapshots WHERE world_folder_id = ? AND user_id = ?'
  ).all(worldFolderId, userId);

  const grantStmt = db.prepare(
    'INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)'
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      grantStmt.run(row.note_id, userId);
    }
    db.prepare(
      'DELETE FROM world_member_grant_snapshots WHERE world_folder_id = ? AND user_id = ?'
    ).run(worldFolderId, userId);
  });
  tx();
}

/**
 * Adds a user to the scope roster and selectively grants notes visible to all existing members.
 * @param {number} scopeFolderId
 * @param {number} newUserId
 * @param {ScopeMode} mode
 * @returns {{ grantedCount: number }}
 */
function grantMemberSelective(scopeFolderId, newUserId, mode) {
  if (mode === 'campaign') {
    const worldId = getWorldParentForCampaign(scopeFolderId);
    if (worldId && !isWorldMember(worldId, newUserId)) {
      const err = new Error('User must be a world member before joining this campaign');
      err.code = 'WORLD_MEMBER_REQUIRED';
      throw err;
    }
  }

  const existingRoster = getRosterUserIds(scopeFolderId).filter((id) => id !== newUserId);
  const scopedIds = collectScopedNoteIds(scopeFolderId, mode);
  const grantStmt = db.prepare(
    'INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)'
  );

  let grantedCount = 0;
  const tx = db.transaction(() => {
    grantStmt.run(scopeFolderId, newUserId);

    for (const noteId of scopedIds) {
      if (noteId === scopeFolderId) continue;
      if (!isNoteVisibleToAllRosterMembers(noteId, existingRoster, scopeFolderId)) continue;
      const result = grantStmt.run(noteId, newUserId);
      if (result.changes > 0) grantedCount += 1;
    }

    if (mode === 'world') {
      restoreWorldMemberGrants(scopeFolderId, newUserId);
    }
  });
  tx();

  return { grantedCount };
}

/**
 * Removes roster membership and scoped note_permissions for a user.
 * @param {number} scopeFolderId
 * @param {number} userId
 * @param {ScopeMode} mode
 */
function revokeMemberScoped(scopeFolderId, userId, mode) {
  const scopedIds = collectScopedNoteIds(scopeFolderId, mode);
  const delPerm = db.prepare('DELETE FROM note_permissions WHERE note_id = ? AND user_id = ?');

  const tx = db.transaction(() => {
    if (mode === 'world') {
      snapshotWorldMemberGrants(scopeFolderId, userId);
    }

    for (const noteId of scopedIds) {
      delPerm.run(noteId, userId);
    }

    db.prepare('DELETE FROM folder_roles WHERE folder_id = ? AND user_id = ?').run(scopeFolderId, userId);
  });
  tx();
}

/**
 * Whether the caller may manage world roster (add/remove members).
 * @param {number} worldFolderId
 * @param {number} callerId
 * @param {boolean} admin
 * @returns {boolean}
 */
function canManageWorldMembers(worldFolderId, callerId, admin) {
  if (admin) return true;
  return isWorldMember(worldFolderId, callerId);
}

module.exports = {
  getScopeFolder,
  getScopeMode,
  getRosterUserIds,
  isWorldMember,
  collectScopedNoteIds,
  canMemberSeeNote,
  isNoteVisibleToAllRosterMembers,
  snapshotWorldMemberGrants,
  restoreWorldMemberGrants,
  grantMemberSelective,
  revokeMemberScoped,
  canManageWorldMembers,
};
