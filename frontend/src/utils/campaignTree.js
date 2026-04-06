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
    if (cur.is_folder && !cur.parent_id) {
      if (cur.is_world) return null;
      return cur.id;
    }
    const parent = cur.parent_id != null ? map.get(cur.parent_id) : null;
    if (cur.is_folder && parent && parent.is_world) return cur.id;
    cur = parent;
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
 * Folders the Web graph and Journal should scope by: excludes world roots; includes
 * standalone campaigns and campaign folders directly under a world.
 * @param {Array<object>} allNotes
 * @returns {Array<object>}
 */
export function getGraphCampaignRoots(allNotes) {
  const notes = allNotes || [];
  const map = notesByIdMap(notes);
  return notes.filter((n) => {
    if (!n.is_folder) return false;
    if (!n.parent_id) return !n.is_world;
    const p = map.get(n.parent_id);
    return !!(p && p.is_world);
  });
}
