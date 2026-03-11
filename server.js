const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const connectionsRoutes = require('./routes/connections');
const adminRoutes = require('./routes/admin');
const journalRoutes = require('./routes/journal');
const imagesRoutes = require('./routes/images');
const snapshotsRoutes = require('./routes/snapshots');

const app = express();

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
app.use('/api/auth', authRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/snapshots', snapshotsRoutes);

// In production, serve the built React app
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`DnD Notes server running on port ${PORT}`);
});
