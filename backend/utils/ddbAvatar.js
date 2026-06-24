const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  SIDEBAR_ICON_MAX_BYTES,
  getImagesDataDir,
  ensureImagesDataDir,
} = require('./sidebarIcon');

const BROWSER_HEADERS = {
  Accept: 'image/*,*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * Resolves the character portrait URL from D&D Beyond v5 character JSON.
 * @param {object} data - Raw character.data from character-service
 * @returns {string|null}
 */
function resolveAvatarUrl(data) {
  const candidates = [
    data?.decorations?.avatarUrl,
    data?.decorations?.largeAvatarUrl,
    data?.decorations?.smallAvatarUrl,
    data?.avatarUrl,
    data?.frameAvatarUrl,
  ];
  for (const url of candidates) {
    const s = String(url || '').trim();
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
  }
  return null;
}

/**
 * Maps Content-Type header to a safe file extension for sidebar icons.
 * @param {string} contentType
 * @returns {string|null}
 */
function extFromContentType(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] || null;
}

/**
 * Downloads a D&D Beyond avatar image into managed storage and returns the API URL.
 * Returns null on any failure (caller falls back to category default emoji).
 * @param {string} avatarUrl - Absolute HTTPS URL from resolveAvatarUrl
 * @returns {Promise<string|null>} e.g. /api/images/files/{hex}.png
 */
async function downloadAvatarToManagedUrl(avatarUrl) {
  const url = String(avatarUrl || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!res.ok) return null;

    const ext = extFromContentType(res.headers.get('content-type'));
    if (!ext) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > SIDEBAR_ICON_MAX_BYTES) return null;

    ensureImagesDataDir();
    const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const fp = path.join(getImagesDataDir(), filename);
    fs.writeFileSync(fp, buf);

    return `/api/images/files/${filename}`;
  } catch {
    return null;
  }
}

/**
 * Resolves avatar URL from character JSON and downloads it to managed storage.
 * @param {object} data - Raw character.data from character-service
 * @returns {Promise<string|null>}
 */
async function downloadCharacterAvatar(data) {
  const url = resolveAvatarUrl(data);
  if (!url) return null;
  return downloadAvatarToManagedUrl(url);
}

module.exports = {
  resolveAvatarUrl,
  downloadAvatarToManagedUrl,
  downloadCharacterAvatar,
};
