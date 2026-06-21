/**
 * DM role checks aligned with backend `isDMOf` / `folder_roles` (world root or campaign folder).
 */

/**
 * Builds an id → note map for ancestor walks.
 * @param {Array<object>|undefined} notes
 * @returns {Map<number, object>}
 */
function notesByIdMap(notes) {
  return new Map((notes || []).map((n) => [n.id, n]));
}

/**
 * True when the user is a DM of any ancestor folder of the note (including the note row when it
 * is a folder), matching backend `isDMOf` semantics via `dmCampaignIds` from GET /meta/my-dm-campaigns.
 * @param {object|null|undefined} note - Row from /api/notes
 * @param {number[]|undefined} dmCampaignIds - Folder ids where the user has folder_roles DM
 * @param {Array<object>|undefined} notes - Full note list for parent walks
 * @returns {boolean}
 */
export function isDmOfNote(note, dmCampaignIds, notes) {
  if (!note || !dmCampaignIds?.length) return false;
  const byId = notesByIdMap(notes);
  let current = note;
  while (current) {
    if (dmCampaignIds.includes(current.id)) return true;
    current = current.parent_id != null ? byId.get(current.parent_id) : null;
  }
  return false;
}
