const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOf, isNoteUnderCompletedArchive } = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');
const { getImagesDataDir } = require('../utils/sidebarIcon');

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

  const dmImg = demoMutateForbiddenMessage(req.user.id, noteId);
  if (dmImg) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({ error: dmImg });
  }

  if (!isAdmin(req.user.id) && isNoteUnderCompletedArchive(noteId)) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({
      error: 'This campaign or world is marked completed; content is read-only. A DM can clear completion on the root folder.',
    });
  }

  if (!isAdmin(req.user.id) && !isDMOf(noteId, req.user.id)) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({ error: 'Only campaign DMs and admins can upload sidebar icons' });
  }

  res.status(201).json({
    url: `/api/images/files/${req.file.filename}`,
  });
});

// POST upload image to a note
router.post('/upload/:noteId', authenticateToken, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });

  const nid = parseInt(req.params.noteId, 10);
  const dmUp = demoMutateForbiddenMessage(req.user.id, nid);
  if (dmUp) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({ error: dmUp });
  }

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

  const dmDel = demoMutateForbiddenMessage(req.user.id, image.note_id);
  if (dmDel) return res.status(403).json({ error: dmDel });

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
