const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const http     = require('http');
const { WebSocketServer } = require('ws');
const jwt      = require('jsonwebtoken');

const authRoutes        = require('./routes/auth');
const notesRoutes       = require('./routes/notes');
const connectionsRoutes = require('./routes/connections');
const adminRoutes       = require('./routes/admin');
const journalRoutes     = require('./routes/journal');
const imagesRoutes      = require('./routes/images');
const snapshotsRoutes   = require('./routes/snapshots');
const recapsRoutes      = require('./routes/recaps');
const backupRoutes      = require('./routes/backup');

const app = express();

// Purge trash items older than 48 hours — runs on startup and every 6 hours
const purgeTrash = () => {
  const db = require('./db/database');
  const result = db.prepare(`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-48 hours')`).run();
  if (result.changes > 0) console.log(`Purged ${result.changes} expired trash items`);
};
purgeTrash();
setInterval(purgeTrash, 6 * 60 * 60 * 1000);

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '20mb' }));

// Serve uploaded images statically
const IMAGES_DIR = path.join(__dirname, '../../data/images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
app.use('/api/images/files', express.static(IMAGES_DIR));

// API routes
app.use('/api/auth',        authRoutes);
app.use('/api/notes',       notesRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/journal',     journalRoutes);
app.use('/api/images',      imagesRoutes);
app.use('/api/snapshots',   snapshotsRoutes);
app.use('/api/recaps',      recapsRoutes);
app.use('/api/backup',      backupRoutes);

// Server time — used by clients for consistent "Today/Yesterday" grouping
app.get('/api/server-time', (req, res) => {
  res.json({ now: new Date().toISOString() });
});

// Version — returns the git commit hash baked in at build time
app.get('/api/version', (req, res) => {
  res.json({ commit: process.env.GIT_COMMIT || 'unknown' });
});

// In production, serve the built React app
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// --- WebSocket server ---
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  // Validate JWT from query param: /ws?token=xxx
  const url    = new URL(req.url, 'http://localhost');
  const token  = url.searchParams.get('token');
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
  } catch {
    ws.close(1008, 'Unauthorized');
    return;
  }

  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// Attach broadcaster to app so routes can call req.app.broadcast(event)
app.broadcast = (event) => {
  const msg = JSON.stringify(event);
  clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
};

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`DnD Notes server running on port ${PORT}`);
});
