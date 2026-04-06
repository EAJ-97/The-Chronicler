const fs = require('fs');
const path = require('path');

/**
 * Absolute path to user-uploaded images (same tree served at GET /api/images/files/*).
 * Resolved from backend/utils → project root data/images.
 */
function getImagesDataDir() {
  return path.join(__dirname, '..', '..', 'data', 'images');
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
  getImagesDataDir,
  isManagedSidebarIconUrl,
  filenameFromManagedSidebarIconUrl,
  unlinkManagedSidebarIconFile,
};
