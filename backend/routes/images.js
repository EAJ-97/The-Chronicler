const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOf } = require('../utils/access');
const { getImagesDataDir } = require('../utils/sidebarIcon');
const { getGeminiIconApiKey } = require('../utils/geminiIconSettings');
const { generateChronicleListIcon } = require('../services/geminiIconImage');

const router = express.Router();

const IMAGES_DIR = getImagesDataDir();
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

/** Shared allow-list for JPEG/PNG/GIF/WebP uploads. */
function imageFileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
}

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: imageFileFilter,
});

/** Smaller limit for sidebar tree icons (square thumbnails). */
const uploadSidebar = multer({
  storage,
  limits: { fileSize: 512 * 1024 }, // 512KB
  fileFilter: imageFileFilter,
});

/**
 * POST multipart image for note list / tree icon only (not the note body gallery).
 * Inserts no note_images row. Allowed for admins and DMs of the note's campaign.
 * Body field name: image (same as /upload/:noteId).
 */
router.post('/sidebar-icon/:noteId', authenticateToken, uploadSidebar.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });

  const noteId = parseInt(req.params.noteId, 10);
  if (Number.isNaN(noteId)) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: 'Invalid note id' });
  }

  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(404).json({ error: 'Note not found' });
  }

  if (!isAdmin(req.user.id) && !isDMOf(noteId, req.user.id)) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({ error: 'Only campaign DMs and admins can upload sidebar icons' });
  }

  res.status(201).json({
    url: `/api/images/files/${req.file.filename}`,
  });
});

/**
 * POST JSON — Gemini image generation for sidebar icons only (DM/admin).
 * Body: { note_id, prompt? }. Saves PNG/JPEG/WebP under /api/images/files like manual uploads.
 */
router.post('/generate-sidebar-icon', authenticateToken, async (req, res) => {
  const noteId = parseInt(req.body?.note_id, 10);
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 400) : '';
  if (!noteId || Number.isNaN(noteId)) return res.status(400).json({ error: 'note_id required' });

  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  if (!isAdmin(req.user.id) && !isDMOf(noteId, req.user.id)) {
    return res.status(403).json({ error: 'Only campaign DMs and admins can generate sidebar icons' });
  }

  const apiKey = getGeminiIconApiKey();
  if (!apiKey) {
    return res.status(503).json({
      error: 'Gemini API key is not configured. Set GEMINI_API_KEY (or GEMINI_ICON_API_KEY) on the server, or add a key in Admin → AI.',
    });
  }

  try {
    const { buffer, mimeType } = await generateChronicleListIcon(apiKey, prompt);
    const maxBytes = 2 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(502).json({ error: 'Generated image too large; try a simpler prompt.' });
    }
    const ext = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : '.jpg';
    const filename = crypto.randomBytes(16).toString('hex') + ext;
    const fp = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(fp, buffer);
    res.status(201).json({ url: `/api/images/files/${filename}` });
  } catch (e) {
    console.error('[images] Gemini sidebar icon:', e.message);
    res.status(502).json({ error: e.message || 'Image generation failed' });
  }
});

// POST upload image to a note
router.post('/upload/:noteId', authenticateToken, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });

  const result = db.prepare(`
    INSERT INTO note_images (note_id, filename, original_name, uploaded_by)
    VALUES (?, ?, ?, ?)
  `).run(req.params.noteId, req.file.filename, req.file.originalname, req.user.id);

  res.status(201).json({
    id: result.lastInsertRowid,
    filename: req.file.filename,
    original_name: req.file.originalname,
    url: `/api/images/files/${req.file.filename}`,
  });
});

// GET all images for a note
router.get('/note/:noteId', authenticateToken, (req, res) => {
  const images = db.prepare('SELECT * FROM note_images WHERE note_id = ? ORDER BY created_at ASC')
    .all(req.params.noteId);
  res.json(images.map(img => ({ ...img, url: `/api/images/files/${img.filename}` })));
});

// DELETE an image
router.delete('/:id', authenticateToken, (req, res) => {
  const image = db.prepare('SELECT * FROM note_images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  // Only uploader, DM of the note's campaign, or admin can delete
  const isDM = isDMOf(image.note_id, req.user.id);
  if (image.uploaded_by !== req.user.id && !isAdmin(req.user.id) && !isDM) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Remove file from disk
  const filePath = path.join(IMAGES_DIR, image.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM note_images WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
