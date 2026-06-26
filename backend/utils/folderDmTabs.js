/**
 * Parse, validate, and serialize DM-only tabbed notes on world/campaign root folders.
 * Each tab: { id: string, title: string, content: string } with markdown body in `content`.
 */

const DEFAULT_TAB_TITLE = 'Notes';
const MAX_TABS = 32;
const MAX_TAB_TITLE_LEN = 80;
const MAX_TAB_CONTENT_LEN = 500000;

/**
 * Generates a stable-enough tab id for new tabs.
 * @returns {string}
 */
function newTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalizes one tab object from client or DB input.
 * @param {unknown} tab
 * @param {number} index - position in array (used for default title)
 * @returns {{ id: string, title: string, content: string }}
 */
function sanitizeTab(tab, index) {
  const id =
    typeof tab?.id === 'string' && tab.id.trim()
      ? tab.id.trim().slice(0, 64)
      : newTabId();
  let title = typeof tab?.title === 'string' ? tab.title.trim().slice(0, MAX_TAB_TITLE_LEN) : '';
  if (!title) title = index === 0 ? DEFAULT_TAB_TITLE : `Tab ${index + 1}`;
  const content =
    typeof tab?.content === 'string' ? tab.content.slice(0, MAX_TAB_CONTENT_LEN) : '';
  return { id, title, content };
}

/**
 * Parses stored JSON (or array) into a sanitized tab list, or null when invalid/empty.
 * @param {string|unknown[]|null|undefined} raw
 * @returns {{ id: string, title: string, content: string }[] | null}
 */
function parseFolderDmTabsJson(raw) {
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
 * Resolves tabs from `folder_dm_tabs` JSON or legacy single `folder_dm_content` string.
 * Always returns at least one tab for DM editors.
 * @param {{ folder_dm_tabs?: string|null, folder_dm_content?: string|null }} note
 * @returns {{ id: string, title: string, content: string }[]}
 */
function normalizeFolderDmTabs(note) {
  const fromJson = parseFolderDmTabsJson(note?.folder_dm_tabs);
  if (fromJson && fromJson.length > 0) return fromJson;
  const legacy = note?.folder_dm_content;
  if (legacy != null && String(legacy).length > 0) {
    return [{ id: 'legacy-1', title: DEFAULT_TAB_TITLE, content: String(legacy) }];
  }
  return [{ id: newTabId(), title: DEFAULT_TAB_TITLE, content: '' }];
}

/**
 * True when all tabs are empty default state (single "Notes" tab, no content).
 * @param {{ id: string, title: string, content: string }[]} tabs
 * @returns {boolean}
 */
function isEmptyDefaultTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length !== 1) return false;
  const t = tabs[0];
  return !String(t.content || '').trim() && (t.title === DEFAULT_TAB_TITLE || !t.title);
}

/**
 * Serializes tabs for DB storage; returns null when equivalent to empty.
 * @param {unknown} input - JSON string or array from client
 * @returns {string|null}
 */
function serializeFolderDmTabs(input) {
  const parsed = parseFolderDmTabsJson(input);
  if (!parsed || parsed.length === 0) return null;
  if (isEmptyDefaultTabs(parsed)) return null;
  return JSON.stringify(parsed);
}

/**
 * Validates client PUT body for folder_dm_tabs; returns sanitized array.
 * @param {unknown} input
 * @returns {{ id: string, title: string, content: string }[]}
 */
function validateFolderDmTabsInput(input) {
  const parsed = parseFolderDmTabsJson(input);
  if (!parsed || parsed.length === 0) {
    return [{ id: newTabId(), title: DEFAULT_TAB_TITLE, content: '' }];
  }
  return parsed;
}

module.exports = {
  DEFAULT_TAB_TITLE,
  newTabId,
  parseFolderDmTabsJson,
  normalizeFolderDmTabs,
  serializeFolderDmTabs,
  validateFolderDmTabsInput,
  isEmptyDefaultTabs,
};
