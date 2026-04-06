const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOfFolder } = require('../utils/access');
const {
  isValidExportRoot,
  buildExportPayload,
  buildStandaloneViewerHtml,
  slugifyTitle,
} = require('../utils/chroniclerBackup');

const router = express.Router();

/**
 * Shared export authorization and payload build for JSON + HTML downloads.
 * @param {import('express').Request} req
 * @returns {{ ok: true, folderId: number, payload: object, slug: string } | { ok: false, status: number, error: string }}
 */
function getExportOrError(req) {
  const folderId = parseInt(req.params.folderId, 10);
  if (!Number.isFinite(folderId)) {
    return { ok: false, status: 400, error: 'Invalid folder id' };
  }

  const uid = req.user.id;
  if (!isAdmin(uid) && !isDMOfFolder(folderId, uid)) {
    return { ok: false, status: 403, error: 'Only the DM or an admin can export this folder' };
  }

  if (!isValidExportRoot(db, folderId)) {
    return {
      ok: false,
      status: 400,
      error:
        'Export is only allowed from a top-level world/campaign folder or a campaign directly under a world',
    };
  }

  let payload;
  try {
    payload = buildExportPayload(db, folderId);
  } catch (e) {
    console.error('backup export:', e);
    return { ok: false, status: 500, error: e.message || 'Export failed' };
  }

  const rootTitle = (payload.notes || []).find((n) => n.id === folderId)?.title || 'export';
  const slug = slugifyTitle(rootTitle);

  return { ok: true, folderId, payload, slug };
}

/**
 * GET /api/backup/export/:folderId/html
 * Self-contained read-only HTML file (embedded data). DM opens locally in a browser — no Chronicler server needed.
 */
router.get('/export/:folderId/html', authenticateToken, (req, res) => {
  const result = getExportOrError(req);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const { folderId, payload, slug } = result;
  let html;
  try {
    html = buildStandaloneViewerHtml(payload);
  } catch (e) {
    console.error('backup export html:', e);
    return res.status(500).json({ error: e.message || 'Failed to build HTML export' });
  }
  const filename = `chronicler-viewer-${slug}-${folderId}.html`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(html);
});

/**
 * GET /api/backup/export/:folderId
 * Pretty-printed JSON for admin re-import and archival.
 */
router.get('/export/:folderId', authenticateToken, (req, res) => {
  const result = getExportOrError(req);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const { folderId, payload, slug } = result;
  const filename = `chronicler-export-${slug}-${folderId}.json`;
  const body = JSON.stringify(payload, null, 2);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(body);
});

module.exports = router;
