/**
 * Tree / sidebar display icons: optional per-row emoji plus defaults by folder kind (world,
 * campaign, subfolder) or note category. Used by NoteList and NoteEditor appearance panels.
 */
import { notesByIdMap } from './campaignTree.js';

/** @typedef {'world'|'campaign'|'subfolder'|'note'} TreeKind */

/**
 * Classifies a folder for icon palette selection (not for access control).
 * @param {object} folder — row with is_folder, parent_id, is_world
 * @param {Map<number, object>} map — id → note
 * @returns {TreeKind}
 */
export function getFolderTreeKind(folder, map) {
  if (!folder?.is_folder) return 'note';
  if (folder.is_world && !folder.parent_id) return 'world';
  const parent = folder.parent_id != null ? map.get(folder.parent_id) : null;
  if (parent?.is_world) return 'campaign';
  // Standalone campaign: root folder that is not a world layer
  if (!folder.parent_id && !folder.is_world) return 'campaign';
  return 'subfolder';
}

/** Cosmic / setting-scale choices for world-layer roots */
export const WORLD_ICONS = ['🌍', '🌐', '🗺️', '✨', '🌙', '🏛️', '🔮', '📿', '🌌', '🌠', '♾️', '⚔️'];

/** Adventure / table-tone choices for campaigns (folder under a world or standalone root) */
export const CAMPAIGN_ICONS = ['📜', '⚔️', '🛡️', '🏰', '🐉', '🎲', '📖', '🗡️', '🔥', '👑', '🌟', '🍺', '⛺', '🗺️'];

/** Nested folder / organization */
export const SUBFOLDER_ICONS = ['📁', '📂', '🗃️', '📋', '🏷️', '⚑', '🗂️', '📌', '🔖', '📑'];

/** Parchment / writing metaphors for notes */
export const NOTE_ICONS = ['📜', '📃', '📄', '📝', '✒️', '📖', '🗞️', '🔖', '💠', '✦'];

const CATEGORY_DEFAULT_EMOJI = {
  npc: '👤',
  location: '📍',
  faction: '⚔️',
  item: '💎',
  event: '📜',
  lore: '📚',
  general: '📜',
};

/**
 * Icon button list for the editor for a given folder kind.
 * @param {TreeKind} kind
 * @returns {readonly string[]}
 */
export function iconChoicesForFolderKind(kind) {
  if (kind === 'world') return WORLD_ICONS;
  if (kind === 'campaign') return CAMPAIGN_ICONS;
  if (kind === 'subfolder') return SUBFOLDER_ICONS;
  return NOTE_ICONS;
}

/**
 * Resolves the emoji shown in the sidebar tree (custom display_icon or sensible default).
 * @param {object} node — note row from API
 * @param {Array<object>} allNotes
 * @returns {string}
 */
export function resolveSidebarIcon(node, allNotes) {
  if (!node) return '📄';
  if (node.display_icon) return node.display_icon;
  const map = notesByIdMap(allNotes);
  if (!node.is_folder) {
    return CATEGORY_DEFAULT_EMOJI[node.category] || '📜';
  }
  const kind = getFolderTreeKind(node, map);
  if (kind === 'world') return '🌍';
  if (kind === 'campaign') return '📜';
  return '📁';
}
