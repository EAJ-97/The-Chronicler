const db = require('../db/database');

// Is this user an admin?
function isAdmin(userId) {
  return !!db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin;
}

// Walk up the note tree to find the root campaign folder id
function getRootFolderId(noteId) {
  if (!noteId) return null;
  let current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(noteId);
  if (!current) return null;
  while (current.parent_id) {
    current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(current.parent_id);
    if (!current) return null;
  }
  return current.id;
}

// Get the "campaign ownership context" folder for a note.
// In a 3-tier model (world -> campaigns -> notes):
//   - Note inside a campaign under a world -> returns the campaign folder (depth 1)
//   - Note inside a standalone campaign -> returns the root folder (same as getRootFolderId)
//   - Note directly under a world layer -> returns the world layer root
function getCampaignFolderId(noteId) {
  if (!noteId) return null;
  let current = db.prepare('SELECT id, parent_id, is_world FROM notes WHERE id = ?').get(noteId);
  if (!current) return null;
  
  // Collect the chain of ancestors
  const chain = [current.id];
  while (current.parent_id) {
    current = db.prepare('SELECT id, parent_id, is_world FROM notes WHERE id = ?').get(current.parent_id);
    if (!current) return null;
    chain.push(current.id);
  }
  
  // Root is the last element (no parent_id)
  const root = chain[chain.length - 1];
  
  // If the root is NOT a world layer (is_world=0), this is a standalone campaign tree
  // Return the root as the campaign context
  const rootRow = db.prepare('SELECT is_world FROM notes WHERE id = ?').get(root);
  if (!rootRow || rootRow.is_world === 0) {
    return root;
  }
  
  // Root IS a world layer (is_world=1)
  // If chain length is 2 (note -> campaign), return the campaign (depth 1)
  // If chain length is 1 (note IS the world root), return the world root
  // If chain length > 2 (note -> subfolder -> campaign), return the campaign folder (depth 1 from world)
  if (chain.length >= 2) {
    return chain[chain.length - 2]; // Return the folder at depth 1 from world
  }
  
  return root; // Note is directly under the world layer
}

// Is this user a DM of the campaign containing noteId?
// In 3-tier model: checks both world-layer DM and campaign-level DM
function isDMOf(noteId, userId) {
  const rootId = getRootFolderId(noteId);
  if (!rootId) return false;
  
  // Check if user is DM of the root (world layer or standalone campaign)
  if (isDMOfFolder(rootId, userId)) return true;
  
  // Check if user is DM of the campaign folder (for notes under a world)
  const campaignId = getCampaignFolderId(noteId);
  if (campaignId && campaignId !== rootId && isDMOfFolder(campaignId, userId)) {
    return true;
  }
  
  return false;
}

// Is this user a DM of a specific root folder directly?
function isDMOfFolder(folderId, userId) {
  return !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(folderId, userId);
}

// Is this user explicitly granted access to a note OR any ancestor folder?
// In 3-tier model: permission boundary stops at getCampaignFolderId
// A world-layer member should NOT automatically see notes inside campaigns
function isGrantedUser(noteId, userId) {
  let current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(noteId);
  const campaignFolderId = getCampaignFolderId(noteId);
  
  while (current) {
    const perm = db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(current.id, userId);
    if (perm) return true;
    
    // Stop at campaign boundary: do not check world-layer permissions for campaign notes
    if (campaignFolderId && current.id === campaignFolderId) {
      // Check this folder but don't go higher
      const perm = db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(current.id, userId);
      return !!perm;
    }
    
    if (!current.parent_id) break;
    current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(current.parent_id);
  }
  return false;
}

/**
 * True if this folder row may hold the "completed" toggle (world root, standalone campaign root,
 * or campaign folder directly under a world layer).
 * @param {{ is_folder?: number, parent_id?: number|null }} note
 * @returns {boolean}
 */
function isCompletionScopeRoot(note) {
  if (!note || !note.is_folder) return false;
  if (note.parent_id == null) return true;
  const p = db.prepare('SELECT is_world FROM notes WHERE id = ?').get(note.parent_id);
  return !!(p && p.is_world === 1);
}

/**
 * Walks ancestors (including self): true if any folder has is_completed set (archived scope).
 * @param {number} noteId
 * @returns {boolean}
 */
function isNoteUnderCompletedArchive(noteId) {
  if (!noteId) return false;
  let cur = db.prepare('SELECT id, parent_id, is_folder, is_completed FROM notes WHERE id = ?').get(noteId);
  while (cur) {
    if (cur.is_folder && cur.is_completed) return true;
    if (!cur.parent_id) return false;
    cur = db.prepare('SELECT id, parent_id, is_folder, is_completed FROM notes WHERE id = ?').get(cur.parent_id);
  }
  return false;
}

/**
 * True when folder id is a world root or a campaign root (standalone or under a world), not a nested subfolder.
 * Matches frontend `getFolderTreeKind` (world | campaign vs subfolder).
 * @param {number} folderId
 * @returns {boolean}
 */
function isWorldOrCampaignRootFolder(folderId) {
  const row = db
    .prepare('SELECT id, is_folder, parent_id, is_world FROM notes WHERE id = ? AND deleted_at IS NULL')
    .get(folderId);
  if (!row?.is_folder) return false;
  if (row.is_world && !row.parent_id) return true;
  if (!row.parent_id && !row.is_world) return true;
  if (row.parent_id) {
    const p = db.prepare('SELECT is_world FROM notes WHERE id = ? AND deleted_at IS NULL').get(row.parent_id);
    if (p?.is_world) return true;
  }
  return false;
}

module.exports = {
  isAdmin,
  getRootFolderId,
  getCampaignFolderId,
  isDMOf,
  isDMOfFolder,
  isGrantedUser,
  isCompletionScopeRoot,
  isNoteUnderCompletedArchive,
  isWorldOrCampaignRootFolder,
};
