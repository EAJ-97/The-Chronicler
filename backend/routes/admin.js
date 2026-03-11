const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const router = express.Router();

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
  res.json({
    ai_enabled: enabled?.value === 'true',
    ai_key_set: rawKey.length > 0,
    ai_key_masked: maskKey(rawKey),
  });
});

// POST save AI settings
router.post('/ai/settings', authenticateToken, adminOnly, async (req, res) => {
  const { ai_enabled, ai_api_key } = req.body;

  // If a new key was provided, save it
  if (typeof ai_api_key === 'string' && ai_api_key.trim().length > 0) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_api_key'").run(ai_api_key.trim());
  }

  // Check if a key exists at all
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get();
  const hasKey = keyRow?.value?.trim().length > 0;

  // Can only enable if a key is present
  const shouldEnable = ai_enabled && hasKey;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_enabled'").run(shouldEnable ? 'true' : 'false');

  const rawKey = keyRow?.value || '';
  res.json({
    ai_enabled: shouldEnable,
    ai_key_set: hasKey,
    ai_key_masked: maskKey(rawKey),
    warning: ai_enabled && !hasKey ? 'API key required to enable AI features. AI has been left disabled.' : null,
  });
});

// POST clear API key (and disable AI)
router.post('/ai/clear-key', authenticateToken, adminOnly, (req, res) => {
  db.prepare("UPDATE settings SET value = '' WHERE key = 'ai_api_key'").run();
  db.prepare("UPDATE settings SET value = 'false' WHERE key = 'ai_enabled'").run();
  res.json({ success: true, ai_enabled: false, ai_key_set: false });
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

// GET AI enabled status — exposed to all authenticated users (not admin-only)
// Used by frontend to show/hide AI features
router.get('/ai/status', authenticateToken, (req, res) => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  res.json({ ai_enabled: enabled?.value === 'true' });
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
    tmpDb.prepare("UPDATE settings SET value = '' WHERE key = 'ai_api_key'").run();
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

module.exports = router;
