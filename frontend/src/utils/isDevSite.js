/** localStorage flag to force dev graph tools visible (e.g. tunneled dev without :3002 in the URL). */
export const DEV_GRAPH_TOOLS_FLAG = 'chronicler_dev_graph_tools';

/**
 * True when the browser URL is a known local dev port (docker 3002 or Vite 5173).
 * @returns {boolean}
 */
export function isDevPort() {
  try {
    const port = window.location.port;
    return port === '3002' || port === '5173';
  } catch {
    return false;
  }
}

/**
 * True when dev graph tools were enabled manually via localStorage.
 * @returns {boolean}
 */
export function isDevGraphToolsForced() {
  try {
    return localStorage.getItem(DEV_GRAPH_TOOLS_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Synchronous dev check: known dev port or localStorage override.
 * @returns {boolean}
 */
export function isDevSite() {
  return isDevPort() || isDevGraphToolsForced();
}

/**
 * Enables dev graph tools via localStorage (survives refresh).
 */
export function forceEnableDevGraphTools() {
  try {
    localStorage.setItem(DEV_GRAPH_TOOLS_FLAG, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Disables the localStorage dev graph tools override.
 */
export function forceDisableDevGraphTools() {
  try {
    localStorage.removeItem(DEV_GRAPH_TOOLS_FLAG);
  } catch {
    /* ignore */
  }
}
