const fs = require('fs');
const path = require('path');

/** Max upload bytes for sidebar tree icons (same as note-body gallery uploads). */
const SIDEBAR_ICON_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Absolute path to user-uploaded images on the persistent data volume (served at GET /api/images/files/*).
 * Uses DB_DIR (/data in Docker) so files survive container rebuilds.
 * @returns {string}
 */
function getImagesDataDir() {
  const base = process.env.DB_DIR || '/data';
  return path.join(base, 'images');
}

/**
 * Ensures the images directory exists and copies any files from the legacy dev path
 * (/app/data/images) into the persistent volume once.
 * @returns {void}
 */
function ensureImagesDataDir() {
  const imagesDir = getImagesDataDir();
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const legacyDir = path.join(__dirname, '..', '..', 'data', 'images');
  if (legacyDir === imagesDir || !fs.existsSync(legacyDir)) return;

  try {
    for (const name of fs.readdirSync(legacyDir)) {
      const from = path.join(legacyDir, name);
      const to = path.join(imagesDir, name);
      if (!fs.statSync(from).isFile() || fs.existsSync(to)) continue;
      fs.copyFileSync(from, to);
    }
  } catch (_) {
    /* ignore migration errors */
  }
}

/** Allowed relative URLs stored in notes.display_icon for custom tree icons (matches generated filenames). */
const MANAGED_ICON_URL_RE = /^\/api\/images\/files\/([a-f0-9]{32}\.(?:jpe?g|png|gif|webp))$/i;

/**
 * True if the value is exactly our API path for a hex-named image (safe to use as img src when same-origin).
 * @param {unknown} s
 * @returns {boolean}
 */
function isManagedSidebarIconUrl(s) {
  return typeof s === 'string' && MANAGED_ICON_URL_RE.test(s.trim());
}

/**
 * Extracts the on-disk filename from a managed sidebar icon URL, or null if invalid.
 * @param {string} s
 * @returns {string|null}
 */
function filenameFromManagedSidebarIconUrl(s) {
  const m = String(s).trim().match(MANAGED_ICON_URL_RE);
  return m ? m[1] : null;
}

/**
 * Deletes the image file for a managed sidebar URL if it exists (used when replacing or clearing the icon).
 * @param {string} url
 */
function unlinkManagedSidebarIconFile(url) {
  const fn = filenameFromManagedSidebarIconUrl(url);
  if (!fn) return;
  const fp = path.join(getImagesDataDir(), fn);
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp);
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = {
  SIDEBAR_ICON_MAX_BYTES,
  getImagesDataDir,
  ensureImagesDataDir,
  isManagedSidebarIconUrl,
  filenameFromManagedSidebarIconUrl,
  unlinkManagedSidebarIconFile,
};
