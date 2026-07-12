/**
 * Campaign / world tree helpers — align UI with DB: world layers (`is_world`) are not
 * playable campaign roots; campaigns are standalone roots or folders whose parent is a world.
 */

/**
 * Builds an id → note map for parent walks (inputs: note rows from /api/notes).
 * @param {Array<object>} notes
 * @returns {Map<number, object>}
 */
export function notesByIdMap(notes) {
  return new Map((notes || []).map((n) => [n.id, n]));
}

/**
 * Returns the playable campaign folder id for the current selection: a standalone root
 * folder (not a world) or any descendant of a campaign that lives under a world layer.
 * Returns null when nothing is selected, the selection is only the world node, or the
 * tree cannot be resolved.
 * @param {Array<object>} notes
 * @param {number|null|undefined} selectedId
 * @returns {number|null}
 */
export function getCampaignFolderIdForSelection(notes, selectedId) {
  if (selectedId == null) return null;
  const map = notesByIdMap(notes);
  let cur = map.get(selectedId);
  while (cur) {
    if (isPlayableCampaignRootFolder(notes, cur)) return cur.id;
    if (!cur.parent_id) return null;
    cur = map.get(cur.parent_id);
  }
  return null;
}

/**
 * True when the selected row is a world-layer root folder (DB: is_world, no parent).
 * @param {Array<object>} notes
 * @param {number|null|undefined} selectedId
 * @returns {boolean}
 */
export function isWorldRootSelected(notes, selectedId) {
  if (selectedId == null) return false;
  const n = notesByIdMap(notes).get(selectedId);
  return !!(n && n.is_folder && !n.parent_id && n.is_world);
}

/**
 * True when a folder is a playable campaign (standalone or under a world with Session Journal).
 * @param {Array<object>} allNotes
 * @param {object} folder
 * @returns {boolean}
 */
export function isPlayableCampaignRootFolder(allNotes, folder) {
  if (!folder?.is_folder) return false;
  if (folder.is_world && !folder.parent_id) return false;
  if (!folder.parent_id && !folder.is_world) return true;

  const hasSessionJournal = (allNotes || []).some(
    (n) => n.parent_id === folder.id
      && n.is_folder
      && String(n.title || '').trim().toLowerCase() === 'session journal',
  );
  if (!hasSessionJournal) return false;

  const map = notesByIdMap(allNotes || []);
  const parent = map.get(folder.parent_id);
  if (!parent) {
    // World parent not in the user's note list (orphan campaign root) — still a campaign.
    return true;
  }
  return !!(parent.is_world && parent.parent_id == null);
}

/**
 * True when a note lives in world-layer scope only (not inside a campaign under a world).
 * Mirrors backend `isNoteInWorldOnlyScope`.
 * @param {Array<object>} allNotes
 * @param {number|null|undefined} noteId
 * @returns {boolean}
 */
export function isNoteInWorldOnlyScope(allNotes, noteId) {
  if (noteId == null) return false;
  const map = notesByIdMap(allNotes || []);
  let cur = map.get(noteId);
  if (!cur) return false;
  let root = cur;
  while (root.parent_id != null) {
    const p = map.get(root.parent_id);
    if (!p) return false;
    root = p;
  }
  if (!root.is_world) return false;
  let walk = map.get(noteId);
  while (walk) {
    if (isPlayableCampaignRootFolder(allNotes, walk)) return false;
    if (walk.id === root.id) return true;
    if (!walk.parent_id) return false;
    walk = map.get(walk.parent_id);
  }
  return false;
}

/**
 * Folders the Web graph and Journal should scope by: excludes world roots; includes
 * standalone campaigns and campaign folders directly under a world.
 * @param {Array<object>} allNotes
 * @returns {Array<object>}
 */
export function getGraphCampaignRoots(allNotes) {
  const notes = allNotes || [];
  return notes.filter((n) => n.is_folder && isPlayableCampaignRootFolder(notes, n));
}

/**
 * All note/folder ids in the subtree rooted at `rootId` (includes the root).
 * @param {Array<object>} allNotes
 * @param {number} rootId
 * @returns {Set<number>}
 */
export function getSubtreeIds(allNotes, rootId) {
  const childrenOf = new Map();
  for (const n of allNotes || []) {
    const pid = n.parent_id;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(n.id);
  }
  const ids = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    ids.add(id);
    for (const cid of (childrenOf.get(id) || [])) queue.push(cid);
  }
  return ids;
}

/**
 * True when this folder row is a world root, standalone campaign root, or campaign folder directly under a world
 * (matches backend `isCompletionScopeRoot` — only these rows may store `is_completed`).
 * @param {object} note - Row from /api/notes
 * @param {Map<number, object>} notesById - From {@link notesByIdMap}
 * @returns {boolean}
 */
export function isCompletionScopeRootNote(note, notesById) {
  if (!note?.is_folder) return false;
  if (!note.parent_id) return true;
  const p = notesById.get(note.parent_id);
  return !!(p && p.is_world);
}

/**
 * True when this row is a folder marked completed (archived scope).
 * Uses strict checks so SQLite 0/1 and JSON do not misread (avoid truthy string "0").
 * @param {object|undefined} row
 * @returns {boolean}
 */
export function isFolderMarkedCompleted(row) {
  if (!row || !row.is_folder) return false;
  const v = row.is_completed;
  return v === 1 || v === true || v === '1';
}

/**
 * True when any ancestor folder has `is_completed` set (walks parent_id chain).
 * Used for client-side read-only UI before GET /notes/:id merges `under_completed_archive`.
 * @param {Array<object>} allNotes
 * @param {number|null|undefined} noteId
 * @returns {boolean}
 */
export function isUnderCompletedArchive(allNotes, noteId) {
  if (noteId == null) return false;
  const map = notesByIdMap(allNotes || []);
  let cur = map.get(noteId);
  while (cur) {
    if (isFolderMarkedCompleted(cur)) return true;
    if (cur.parent_id == null) return false;
    cur = map.get(cur.parent_id);
  }
  return false;
}
