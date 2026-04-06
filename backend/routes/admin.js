const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const router = express.Router();
const { getGeminiIconApiKey, geminiIconKeyFromEnv } = require('../utils/geminiIconSettings');

// Middleware: admin only
function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// GET all users
router.get('/users', authenticateToken, adminOnly, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC'
  ).all();
  res.json(users);
});

// POST create a user (admin only)
router.post('/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username, password, is_admin = false } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
    ).run(username, passwordHash, is_admin ? 1 : 0);

    res.status(201).json({
      id: result.lastInsertRowid,
      username,
      is_admin: is_admin ? 1 : 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a user (admin only, can't delete yourself)
router.delete('/users/:id', authenticateToken, adminOnly, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id)
    return res.status(400).json({ error: "You can't delete your own account" });

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true });
});

// POST toggle registration open/closed
router.post('/settings/registration', authenticateToken, adminOnly, (req, res) => {
  const { open } = req.body;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'registration_open'")
    .run(open ? 'true' : 'false');
  res.json({ registration_open: open });
});

// GET current settings
router.get('/settings', authenticateToken, adminOnly, (req, res) => {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
  res.json({ registration_open: setting?.value === 'true' });
});

// GET demo status
router.get('/demo/status', authenticateToken, adminOnly, (req, res) => {
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get();
  res.json({ demo_seeded: seeded?.value === 'true' });
});

// POST generate demo data
router.post('/demo/generate', authenticateToken, adminOnly, (req, res) => {
  try {
    const { seed } = require('../db/demoSeeder');
    const result = seed();
    res.json(result);
  } catch (err) {
    console.error('[demo/generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE wipe demo data
router.delete('/demo/wipe', authenticateToken, adminOnly, (req, res) => {
  try {
    const { wipe } = require('../db/demoSeeder');
    const result = wipe();
    res.json(result);
  } catch (err) {
    console.error('[demo/wipe]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST change own password
router.post('/change-password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare("UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?").run(hash, req.user.id);
  res.json({ success: true });
});

// ── AI SETTINGS ──────────────────────────────────────────────────────────────

// Helper: mask key for safe display (never send raw key to frontend)
function maskKey(key) {
  if (!key || key.length < 12) return '';
  return key.slice(0, 10) + '•'.repeat(Math.min(20, key.length - 14)) + key.slice(-4);
}

// GET AI settings (key returned masked)
router.get('/ai/settings', authenticateToken, adminOnly, (req, res) => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  const keyRow  = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get();
  const rawKey  = keyRow?.value || '';
  const gemRow  = db.prepare("SELECT value FROM settings WHERE key = 'gemini_icon_api_key'").get();
  const rawGem  = gemRow?.value || '';
  const envGem  = geminiIconKeyFromEnv();
  res.json({
    ai_enabled: enabled?.value === 'true',
    ai_key_set: rawKey.length > 0,
    ai_key_masked: maskKey(rawKey),
    gemini_icon_key_set: envGem || rawGem.trim().length > 0,
    gemini_icon_key_masked: envGem ? '(GEMINI_API_KEY on server — not stored in DB)' : maskKey(rawGem),
    gemini_icon_from_env: envGem,
  });
});

// POST save AI settings
router.post('/ai/settings', authenticateToken, adminOnly, async (req, res) => {
  const { ai_enabled, ai_api_key, gemini_icon_api_key } = req.body;

  // If a new key was provided, save it
  if (typeof ai_api_key === 'string' && ai_api_key.trim().length > 0) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_api_key'").run(ai_api_key.trim());
  }

  if (typeof gemini_icon_api_key === 'string' && gemini_icon_api_key.trim().length > 0) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'gemini_icon_api_key'").run(gemini_icon_api_key.trim());
  }

  // Check if a key exists at all
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get();
  const hasKey = keyRow?.value?.trim().length > 0;

  // Can only enable if a key is present
  const shouldEnable = ai_enabled && hasKey;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_enabled'").run(shouldEnable ? 'true' : 'false');

  const rawKey = keyRow?.value || '';
  const gemRow = db.prepare("SELECT value FROM settings WHERE key = 'gemini_icon_api_key'").get();
  const rawGem = gemRow?.value || '';
  const envGem = geminiIconKeyFromEnv();
  res.json({
    ai_enabled: shouldEnable,
    ai_key_set: hasKey,
    ai_key_masked: maskKey(rawKey),
    gemini_icon_key_set: envGem || rawGem.trim().length > 0,
    gemini_icon_key_masked: envGem ? '(GEMINI_API_KEY on server — not stored in DB)' : maskKey(rawGem),
    gemini_icon_from_env: envGem,
    warning: ai_enabled && !hasKey ? 'API key required to enable AI features. AI has been left disabled.' : null,
  });
});

// POST clear API key (and disable AI)
router.post('/ai/clear-key', authenticateToken, adminOnly, (req, res) => {
  db.prepare("UPDATE settings SET value = '' WHERE key = 'ai_api_key'").run();
  db.prepare("UPDATE settings SET value = 'false' WHERE key = 'ai_enabled'").run();
  res.json({ success: true, ai_enabled: false, ai_key_set: false });
});

/** Clears the database copy of the Gemini icon key only (environment variable still applies). */
router.post('/ai/clear-gemini-icon-key', authenticateToken, adminOnly, (req, res) => {
  db.prepare("UPDATE settings SET value = '' WHERE key = 'gemini_icon_api_key'").run();
  const envGem = geminiIconKeyFromEnv();
  res.json({
    success: true,
    gemini_icon_key_set: envGem,
    gemini_icon_key_masked: envGem ? '(GEMINI_API_KEY on server — not stored in DB)' : '',
    gemini_icon_from_env: envGem,
  });
});

// POST test API key — makes a minimal call to Anthropic to verify it works
router.post('/ai/test-key', authenticateToken, adminOnly, async (req, res) => {
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get();
  const apiKey = keyRow?.value?.trim();
  if (!apiKey) return res.status(400).json({ error: 'No API key saved.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with just: OK' }],
      }),
    });

    if (response.ok) {
      return res.json({ success: true, message: 'API key is valid and working.' });
    } else {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${response.status}`;
      return res.status(400).json({ error: `Key rejected by Anthropic: ${msg}` });
    }
  } catch (e) {
    return res.status(500).json({ error: `Connection failed: ${e.message}` });
  }
});

/**
 * Verifies the configured Gemini key with a minimal models list call (no image generation).
 */
router.post('/ai/test-gemini-icon-key', authenticateToken, adminOnly, async (req, res) => {
  const apiKey = getGeminiIconApiKey();
  if (!apiKey) {
    return res.status(400).json({ error: 'No Gemini API key configured (environment or database).' });
  }
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (response.ok) {
      return res.json({ success: true, message: 'Gemini API key is valid.' });
    }
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${response.status}`;
    return res.status(400).json({ error: `Gemini rejected the key: ${msg}` });
  } catch (e) {
    return res.status(500).json({ error: `Connection failed: ${e.message}` });
  }
});

// GET AI enabled status — exposed to all authenticated users (not admin-only)
// Used by frontend to show/hide AI features
router.get('/ai/status', authenticateToken, (req, res) => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  const gemDb = db.prepare("SELECT value FROM settings WHERE key = 'gemini_icon_api_key'").get()?.value?.trim();
  const geminiConfigured = geminiIconKeyFromEnv() || !!gemDb;
  res.json({
    ai_enabled: enabled?.value === 'true',
    gemini_icon_configured: geminiConfigured,
  });
});

// ── BACKUP ────────────────────────────────────────────────────────────────

// GET /admin/backup/download — streams a sanitized copy of the DB
router.get('/backup/download', authenticateToken, adminOnly, (req, res) => {
  const DB_DIR  = process.env.DB_DIR || '/data';
  const srcPath = path.join(DB_DIR, 'dnd_notes.db');

  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'Database file not found.' });
  }

  // Write a clean checkpoint so WAL is flushed into main db file
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}

  // Copy to temp file
  const tmpPath = path.join(os.tmpdir(), `chronicler_backup_${Date.now()}.db`);
  fs.copyFileSync(srcPath, tmpPath);

  // Open the copy and scrub sensitive settings
  const Database = require('better-sqlite3');
  let tmpDb;
  try {
    tmpDb = new Database(tmpPath);
    tmpDb.prepare("UPDATE settings SET value = '' WHERE key IN ('ai_api_key', 'gemini_icon_api_key')").run();
    tmpDb.close();
  } catch (e) {
    try { tmpDb?.close(); } catch {}
    fs.unlinkSync(tmpPath);
    return res.status(500).json({ error: 'Failed to sanitize backup: ' + e.message });
  }

  const date  = new Date().toISOString().slice(0, 10);
  const fname = `chronicler_backup_${date}.db`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.setHeader('Content-Length', fs.statSync(tmpPath).size);

  const stream = fs.createReadStream(tmpPath);
  stream.pipe(res);
  stream.on('end', () => { try { fs.unlinkSync(tmpPath); } catch {} });
  stream.on('error', () => { try { fs.unlinkSync(tmpPath); } catch {} res.end(); });
});

// GET /admin/backup/info — returns db size and last modified
router.get('/backup/info', authenticateToken, adminOnly, (req, res) => {
  const DB_DIR  = process.env.DB_DIR || '/data';
  const srcPath = path.join(DB_DIR, 'dnd_notes.db');
  try {
    const stat = fs.statSync(srcPath);
    res.json({
      size_bytes: stat.size,
      size_kb: Math.round(stat.size / 1024),
      last_modified: stat.mtime.toISOString(),
    });
  } catch {
    res.json({ size_bytes: 0, size_kb: 0, last_modified: null });
  }
});

// In-memory cache for GitHub release check (avoids rate limits)
const UPDATE_CHECK_CACHE_MS = 60 * 60 * 1000; // 1 hour
let updateCheckCache = null;

// Compare two semver strings (e.g. "0.1.1" vs "0.1.2"). Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// GET /admin/update-check — tells admin if a newer release exists on GitHub (read-only, no action button)
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || 'EAJ-97/The-Chronicler';
router.get('/update-check', authenticateToken, adminOnly, async (req, res) => {
  const currentVersion = require('../package.json').version;
  const now = Date.now();
  if (updateCheckCache && (now - updateCheckCache.at) < UPDATE_CHECK_CACHE_MS) {
    return res.json(updateCheckCache.data);
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Chronicler-Update-Check' },
    });
    if (!r.ok) {
      updateCheckCache = { at: now, data: { updateAvailable: false, currentVersion, latestVersion: null, latestTag: null, error: 'Could not fetch releases' } };
      return res.json(updateCheckCache.data);
    }
    const data = await r.json();
    const latestTag = data.tag_name || '';
    const latestVersion = latestTag.replace(/^v/, '');
    const updateAvailable = compareSemver(currentVersion, latestVersion) < 0;
    updateCheckCache = { at: now, data: { updateAvailable, currentVersion, latestVersion, latestTag } };
    res.json(updateCheckCache.data);
  } catch (e) {
    updateCheckCache = { at: now, data: { updateAvailable: false, currentVersion, latestVersion: null, latestTag: null, error: e.message } };
    res.json(updateCheckCache.data);
  }
});

module.exports = router;
