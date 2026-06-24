/**
 * Sidebar tree ordering helpers for manual DM drag-and-drop reorder.
 */

/**
 * Compares two note rows the same way as the sidebar tree (folders first, then sort_order, then title).
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareSidebarNodes(a, b) {
  if (a.is_folder !== b.is_folder) return b.is_folder - a.is_folder;
  const ao = Number(a.sort_order) || 0;
  const bo = Number(b.sort_order) || 0;
  if (ao !== bo) return ao - bo;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

/**
 * Returns sibling rows under the same parent (excluding soft-deleted).
 * @param {Array<object>} notes
 * @param {number|null} parentId
 * @param {number} [excludeId]
 * @returns {Array<object>}
 */
export function siblingsUnderParent(notes, parentId, excludeId) {
  const pid = parentId ?? null;
  return (notes || [])
    .filter((n) => (n.parent_id ?? null) === pid && n.id !== excludeId && !n.deleted_at)
    .sort(compareSidebarNodes);
}

/**
 * Computes sort_order updates after dropping a row before/after a sibling.
 * May return multiple rows when rebalancing equal sort_order values.
 * @param {Array<object>} notes
 * @param {number} draggedId
 * @param {number} targetId
 * @param {'before'|'after'} edge
 * @returns {Array<{ id: number, parent_id: number|null, sort_order: number }>}
 */
export function planSiblingReorder(notes, draggedId, targetId, edge) {
  const dragged = notes.find((n) => n.id === draggedId);
  const target = notes.find((n) => n.id === targetId);
  if (!dragged || !target) return [];

  const parentId = target.parent_id ?? null;
  const siblings = siblingsUnderParent(notes, parentId, draggedId);
  let insertAt = siblings.findIndex((n) => n.id === targetId);
  if (insertAt < 0) return [];
  if (edge === 'after') insertAt += 1;

  const allZero = siblings.every((n) => !Number(n.sort_order));
  const prev = siblings[insertAt - 1];
  const next = siblings[insertAt];

  if (allZero || !prev || !next || prev.sort_order >= next.sort_order) {
    const ordered = [...siblings];
    ordered.splice(insertAt, 0, { id: draggedId });
    return ordered.map((row, index) => ({
      id: row.id,
      parent_id: parentId,
      sort_order: (index + 1) * 1000,
    }));
  }

  if (!prev) {
    return [{ id: draggedId, parent_id: parentId, sort_order: (next.sort_order || 0) - 1000 }];
  }
  if (!next) {
    return [{ id: draggedId, parent_id: parentId, sort_order: (prev.sort_order || 0) + 1000 }];
  }

  const mid = Math.floor((prev.sort_order + next.sort_order) / 2);
  if (mid > prev.sort_order && mid < next.sort_order) {
    return [{ id: draggedId, parent_id: parentId, sort_order: mid }];
  }

  const ordered = [...siblings];
  ordered.splice(insertAt, 0, { id: draggedId });
  return ordered.map((row, index) => ({
    id: row.id,
    parent_id: parentId,
    sort_order: (index + 1) * 1000,
  }));
}

/**
 * Appends a moved note to the end of a folder's children sort order.
 * @param {Array<object>} notes
 * @param {number} folderId
 * @returns {number}
 */
export function sortOrderForFolderEnd(notes, folderId) {
  const children = siblingsUnderParent(notes, folderId);
  if (!children.length) return 1000;
  const max = Math.max(...children.map((n) => Number(n.sort_order) || 0));
  return max + 1000;
}
