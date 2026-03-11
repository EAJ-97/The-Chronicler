const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { seedDemoForAdmin, seedDemoForUser } = require('../utils/demoSeed');

const router = express.Router();

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

module.exports = router;
