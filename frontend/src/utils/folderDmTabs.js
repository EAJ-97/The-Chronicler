/**
 * Client helpers for DM-only tabbed notes on world/campaign root folders.
 * Mirrors backend/utils/folderDmTabs.js for parse/normalize behavior.
 */

export const DEFAULT_DM_TAB_TITLE = 'Notes';
const MAX_TABS = 32;
const MAX_TAB_TITLE_LEN = 80;

/**
 * Generates a unique tab id for new DM tabs.
 * @returns {string}
 */
export function newDmTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sanitizes one tab from API or local state.
 * @param {unknown} tab
 * @param {number} index
 * @returns {{ id: string, title: string, content: string }}
 */
function sanitizeTab(tab, index) {
  const id =
    typeof tab?.id === 'string' && tab.id.trim()
      ? tab.id.trim().slice(0, 64)
      : newDmTabId();
  let title = typeof tab?.title === 'string' ? tab.title.trim().slice(0, MAX_TAB_TITLE_LEN) : '';
  if (!title) title = index === 0 ? DEFAULT_DM_TAB_TITLE : `Tab ${index + 1}`;
  const content = typeof tab?.content === 'string' ? tab.content : '';
  return { id, title, content };
}

/**
 * Parses folder_dm_tabs JSON from the server.
 * @param {string|unknown[]|null|undefined} raw
 * @returns {{ id: string, title: string, content: string }[] | null}
 */
export function parseFolderDmTabsJson(raw) {
  if (raw == null || raw === '') return null;
  let arr;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.slice(0, MAX_TABS).map(sanitizeTab);
}

/**
 * Builds tab list from note row (tabs JSON or legacy folder_dm_content).
 * @param {{ folder_dm_tabs?: string|null, folder_dm_content?: string|null }|null|undefined} note
 * @returns {{ id: string, title: string, content: string }[]}
 */
export function folderDmTabsFromNote(note) {
  const fromJson = parseFolderDmTabsJson(note?.folder_dm_tabs);
  if (fromJson?.length) return fromJson;
  const legacy = note?.folder_dm_content;
  if (legacy != null && String(legacy).length > 0) {
    return [{ id: 'legacy-1', title: DEFAULT_DM_TAB_TITLE, content: String(legacy) }];
  }
  return [{ id: newDmTabId(), title: DEFAULT_DM_TAB_TITLE, content: '' }];
}

/**
 * Creates a new empty DM tab with optional title.
 * @param {string} [title]
 * @returns {{ id: string, title: string, content: string }}
 */
export function createDmTab(title = 'New tab') {
  return { id: newDmTabId(), title, content: '' };
}

/**
 * Serializes tabs for PUT /notes/:id (null when empty default).
 * @param {{ id: string, title: string, content: string }[]} tabs
 * @returns {string|null}
 */
export function serializeFolderDmTabsForSave(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  const sanitized = tabs.slice(0, MAX_TABS).map(sanitizeTab);
  const allEmpty = sanitized.every((t) => !String(t.content || '').trim());
  if (sanitized.length === 1 && allEmpty && sanitized[0].title === DEFAULT_DM_TAB_TITLE) {
    return null;
  }
  return JSON.stringify(sanitized);
}

/**
 * Formats tabs for conflict modal display (titles + content blocks).
 * @param {{ id: string, title: string, content: string }[]} tabs
 * @returns {string}
 */
export function formatDmTabsForConflict(tabs) {
  if (!tabs?.length) return '';
  return tabs
    .map((t) => `## ${t.title || 'Untitled'}\n\n${t.content || ''}`)
    .join('\n\n---\n\n');
}
