const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { seedDemoForAdmin, seedDemoForUser } = require('../utils/demoSeed');

const router = express.Router();

/**
 * Compares two recovery secrets in constant time using SHA-256 digests (avoids length leaks on raw strings).
 * @param {string} provided - Token sent by the client
 * @param {string} expected - Value from `process.env.ADMIN_RECOVERY_TOKEN`
 * @returns {boolean}
 */
function recoverySecretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const p = crypto.createHash('sha256').update(String(provided), 'utf8').digest();
  const e = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(p, e);
}

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if any users exist yet — first user becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const isFirstUser = userCount.count === 0;

    // If not first user, check if registration is open
    if (!isFirstUser) {
      const setting = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
      if (setting?.value !== 'true') {
        return res.status(403).json({ error: 'Registration is closed. Ask your admin to create an account for you.' });
      }
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
    ).run(username, passwordHash, isFirstUser ? 1 : 0);

    // Seed demo data
    try {
      if (isFirstUser) {
        seedDemoForAdmin(result.lastInsertRowid);
      } else {
        seedDemoForUser(result.lastInsertRowid);
      }
    } catch (seedErr) {
      console.error('Demo seed failed (non-fatal):', seedErr.message);
    }

    const token = jwt.sign(
      { id: result.lastInsertRowid, username, is_admin: isFirstUser ? 1 : 0 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: result.lastInsertRowid, username, is_admin: isFirstUser ? 1 : 0 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin, force_password_change: user.force_password_change || 0 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin, force_password_change: user.force_password_change || 0 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, is_admin, force_password_change FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

/**
 * GET /auth/recovery-status — whether the server has a recovery token configured (no secret leaked).
 * Used by the login screen to show the admin recovery form only when applicable.
 */
router.get('/recovery-status', (req, res) => {
  const tok = process.env.ADMIN_RECOVERY_TOKEN;
  const enabled = !!(tok && String(tok).trim().length >= 16);
  res.json({ enabled });
});

/**
 * POST /auth/recover-admin — set a new password for an admin account using `ADMIN_RECOVERY_TOKEN` from the environment.
 * No JWT; intended for operators who can edit `.env` on the host. Optional `username` selects which admin
 * when multiple exist; otherwise the lowest-id admin row is updated.
 * Body: `{ recovery_token, new_password, username? }`
 */
router.post('/recover-admin', async (req, res) => {
  try {
    const expected = process.env.ADMIN_RECOVERY_TOKEN;
    if (!expected || String(expected).trim().length < 16) {
      return res.status(503).json({ error: 'Admin password recovery is not configured on this server.' });
    }
    const { recovery_token, new_password, username } = req.body;
    if (!recovery_token || !new_password) {
      return res.status(400).json({ error: 'recovery_token and new_password are required' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!recoverySecretsMatch(recovery_token, expected)) {
      return res.status(401).json({ error: 'Invalid recovery token' });
    }
    let target;
    if (username && String(username).trim()) {
      target = db.prepare('SELECT id FROM users WHERE username = ? AND is_admin = 1').get(String(username).trim());
      if (!target) return res.status(404).json({ error: 'Admin user not found' });
    } else {
      target = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').get();
      if (!target) return res.status(404).json({ error: 'No admin user found' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?').run(hash, target.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
