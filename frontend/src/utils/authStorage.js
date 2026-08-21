/**
 * Reads/writes Chronicler auth credentials across localStorage (remember me)
 * and sessionStorage (browser-session only). Prefer remember-me storage when both exist.
 */

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

/**
 * Returns the storage that currently holds a token, preferring localStorage.
 * @returns {Storage|null}
 */
function activeAuthStorage() {
  try {
    if (localStorage.getItem(TOKEN_KEY)) return localStorage;
    if (sessionStorage.getItem(TOKEN_KEY)) return sessionStorage;
  } catch {
    /* private mode / blocked storage */
  }
  return null;
}

/**
 * Reads the JWT from localStorage or sessionStorage.
 * @returns {string|null}
 */
export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Reads the cached user JSON string from the same store as the token.
 * @returns {string|null}
 */
export function getAuthUserRaw() {
  const store = activeAuthStorage();
  if (!store) return null;
  try {
    return store.getItem(USER_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists token + user after login/register.
 * @param {object} userData
 * @param {string} token
 * @param {boolean} [rememberMe=true] - When true, use localStorage (survives browser close); otherwise sessionStorage.
 * @returns {void}
 */
export function setAuthSession(userData, token, rememberMe = true) {
  const primary = rememberMe ? localStorage : sessionStorage;
  const secondary = rememberMe ? sessionStorage : localStorage;
  try {
    secondary.removeItem(TOKEN_KEY);
    secondary.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  try {
    primary.setItem(TOKEN_KEY, token);
    primary.setItem(USER_KEY, JSON.stringify(userData));
  } catch {
    /* ignore */
  }
}

/**
 * Clears token and user from both storages (logout / expired session).
 * @returns {void}
 */
export function clearAuthSession() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      store.removeItem(TOKEN_KEY);
      store.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  }
}
