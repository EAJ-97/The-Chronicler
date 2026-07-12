/**
 * Helpers for folder child-note preview cards (party-visible notes under organizer subfolders).
 */

import {
  getSubtreeIds,
  isPlayableCampaignRootFolder,
  notesByIdMap,
} from './campaignTree.js';

/**
 * True when a folder row is a world root or playable campaign root (no note-card previews).
 * @param {Array<object>} allNotes
 * @param {object} folder
 * @returns {boolean}
 */
export function isScopeRootFolder(allNotes, folder) {
  if (!folder?.is_folder) return false;
  if (folder.is_world && !folder.parent_id) return true;
  return isPlayableCampaignRootFolder(allNotes, folder);
}

/**
 * Returns non-folder notes in the subtree of `folderId`, excluding notes whose immediate
 * parent is a world root or campaign root folder.
 * @param {Array<object>} allNotes - Rows from GET /api/notes (content may be omitted)
 * @param {number} folderId
 * @param {{ isDM?: boolean, isAdmin?: boolean }} viewer
 * @returns {Array<object>}
 */
export function getFolderPreviewDescendantNotes(allNotes, folderId, viewer = {}) {
  const { isDM = false, isAdmin = false } = viewer;
  const notes = allNotes || [];
  const map = notesByIdMap(notes);
  const fid = Number(folderId);
  const subtree = getSubtreeIds(notes, fid);

  return notes
    .filter((n) => subtree.has(n.id) && !n.is_folder && Number(n.id) !== fid)
    .filter((n) => {
      const parent = map.get(Number(n.parent_id));
      if (!parent) return true;
      if (parent.is_world && !parent.parent_id) return false;
      if (isPlayableCampaignRootFolder(notes, parent)) return false;
      return true;
    })
    .filter((n) => !n.is_dm_only || isDM || isAdmin)
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

/**
 * True when folder party `content` is empty (whitespace only).
 * @param {string|null|undefined} content
 * @returns {boolean}
 */
export function isFolderPartyContentEmpty(content) {
  return !String(content || '').trim();
}

/** @deprecated Use getFolderPreviewDescendantNotes */
export function getFolderPreviewChildNotes(allNotes, folderId, viewer) {
  return getFolderPreviewDescendantNotes(allNotes, folderId, viewer);
}
