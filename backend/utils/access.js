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

// Is this user a DM of the campaign containing noteId?
function isDMOf(noteId, userId) {
  const rootId = getRootFolderId(noteId);
  if (!rootId) return false;
  return !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(rootId, userId);
}

// Is this user a DM of a specific root folder directly?
function isDMOfFolder(folderId, userId) {
  return !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(folderId, userId);
}

// Is this user explicitly granted access to a note OR any ancestor folder?
function isGrantedUser(noteId, userId) {
  let current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(noteId);
  while (current) {
    const perm = db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(current.id, userId);
    if (perm) return true;
    if (!current.parent_id) break;
    current = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(current.parent_id);
  }
  return false;
}

module.exports = { isAdmin, getRootFolderId, isDMOf, isDMOfFolder, isGrantedUser };
