const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, getRootFolderId } = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');
const {
  buildRecapPromptsForSession,
  getRecapSourcesForSession,
  parseModelRecapOutput,
  assembleRecapMarkdown,
} = require('../utils/recapPromptBuild');
const { getRecapModel, modelSupportsTemperature, extractAssistantText } = require('../utils/aiModels');

const router = express.Router();

/**
 * Shared quota / lock checks before generating or submitting a recap.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function assertRecapQuota(uid, sessionId) {
  const admin = isAdmin(uid);
  const dm = isDM(uid, sessionId);
  const used = getUsage(uid, sessionId);
  const allowed = getAllowedCount(uid, sessionId);
  if (!admin && !dm && standardUserAlreadyGenerated(sessionId) && used === 0) {
    return { ok: false, status: 403, error: 'Another party member has already generated a recap for this session.' };
  }
  if (allowed !== Infinity && used >= allowed) {
    return { ok: false, status: 403, error: `You have used all ${allowed} recap generation${allowed > 1 ? 's' : ''} for this session.` };
  }
  return { ok: true };
}

/**
 * Persists recap row, bumps usage, broadcasts, returns recap row with author.
 * @param {number} sessionId
 * @param {number} folderId
 * @param {number} uid
 * @param {string} tone
 * @param {string} content
 * @param {import('express').Request} req
 * @param {object} [sources]
 */
function insertRecapAndRespond(sessionId, folderId, uid, tone, content, req, res, sources) {
  const recapResult = db.prepare(`
    INSERT INTO recaps (session_id, folder_id, generated_by, tone, content, is_dm_only)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(sessionId, folderId, uid, tone, content);

  db.prepare(`
    INSERT INTO recap_usage (session_id, user_id, count) VALUES (?, ?, 1)
    ON CONFLICT(session_id, user_id) DO UPDATE SET count = count + 1
  `).run(sessionId, uid);

  const recap = db.prepare(
    'SELECT r.*, u.username as author FROM recaps r JOIN users u ON u.id = r.generated_by WHERE r.id = ?'
  ).get(recapResult.lastInsertRowid);

  if (req.app.broadcast) {
    req.app.broadcast({ type: 'recap_generated', session_id: sessionId, recap_id: recap.id, generated_by: uid });
  }

  res.json({ recap, sources: sources || null });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Check if user is DM of the root campaign folder for a session
function isDM(userId, sessionId) {
  const session = db.prepare('SELECT folder_id FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.folder_id) return false;
  const rootId = getRootFolderId(session.folder_id);
  return !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(rootId, userId);
}

// Get usage count for a user on a session
function getUsage(userId, sessionId) {
  return db.prepare('SELECT count FROM recap_usage WHERE session_id = ? AND user_id = ?').get(sessionId, userId)?.count || 0;
}

// Check if any non-admin, non-DM user has already generated a recap for this session
function standardUserAlreadyGenerated(sessionId) {
  const usages = db.prepare('SELECT user_id, count FROM recap_usage WHERE session_id = ?').all(sessionId);
  for (const u of usages) {
    if (!isAdmin(u.user_id) && !isDM(u.user_id, sessionId) && u.count > 0) return true;
  }
  return false;
}

// Determine allowed recap count for user
function getAllowedCount(userId, sessionId) {
  if (isAdmin(userId)) return Infinity;
  if (isDM(userId, sessionId)) return 3;
  return 1;
}

function canEditRecap(uid, recap) {
  if (!recap) return false;
  if (isAdmin(uid)) return true;
  if (recap.generated_by === uid) return true;
  return isDM(uid, recap.session_id);
}

// ── GET /recaps/session/:sessionId ─────────────────────────────────────────
// Returns all non-dm-only recaps for a session (+ dm-only if requester is DM/admin)
router.get('/session/:sessionId', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const uid = req.user.id;
  const admin = isAdmin(uid);
  const dm = isDM(uid, sessionId);

  const recaps = db.prepare(`
    SELECT r.*, u.username as author
    FROM recaps r
    JOIN users u ON u.id = r.generated_by
    WHERE r.session_id = ?
    ORDER BY r.created_at DESC
  `).all(sessionId);

  const visible = recaps.filter(r => !r.is_dm_only || admin || dm);
  res.json(visible);
});

// ── GET /recaps/usage/:sessionId ───────────────────────────────────────────
// Returns usage info for current user on this session
router.get('/usage/:sessionId', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const uid = req.user.id;
  const admin = isAdmin(uid);
  const dm = isDM(uid, sessionId);
  const used = getUsage(uid, sessionId);
  const allowed = getAllowedCount(uid, sessionId);
  const standardLocked = !admin && !dm && standardUserAlreadyGenerated(sessionId) && used === 0;

  res.json({
    used,
    allowed: allowed === Infinity ? null : allowed,
    remaining: allowed === Infinity ? null : Math.max(0, allowed - used),
    can_generate: !standardLocked && (allowed === Infinity || used < allowed),
    is_admin: admin,
    is_dm: dm,
    standard_locked: standardLocked,
  });
});

// ── GET /recaps/sources/:sessionId ─────────────────────────────────────────
// Confirms which session journal will be sent to the model (no note bodies / other sessions)
router.get('/sources/:sessionId', authenticateToken, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (Number.isNaN(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  const built = getRecapSourcesForSession(sessionId);
  if (!built.ok) return res.status(built.status).json({ error: built.error });
  res.json(built.sources);
});

// ── POST /recaps/generate ──────────────────────────────────────────────────
router.post('/generate', authenticateToken, async (req, res) => {
  const { session_id, tone = 'chronicle' } = req.body;
  const uid = req.user.id;

  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const q = assertRecapQuota(uid, session_id);
  if (!q.ok) return res.status(q.status).json({ error: q.error });

  const sessRow = db.prepare('SELECT folder_id FROM sessions WHERE id = ?').get(session_id);
  if (sessRow?.folder_id != null) {
    const dmRec = demoMutateForbiddenMessage(uid, sessRow.folder_id);
    if (dmRec) return res.status(403).json({ error: dmRec });
  }

  const aiEnabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  if (aiEnabled?.value !== 'true') return res.status(503).json({ error: 'AI features are not enabled.' });

  const t = tone === 'summary' ? 'summary' : 'chronicle';
  const built = buildRecapPromptsForSession(session_id, t);
  if (!built.ok) return res.status(built.status).json({ error: built.error });

  const {
    session,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    sources,
    temperature,
  } = built;

  try {
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get()?.value?.trim();
    if (!apiKey) return res.status(503).json({ error: 'No Anthropic API key configured.' });

    const debugOn = ['1', 'true', 'yes'].includes(String(process.env.RECAP_DEBUG || '').trim().toLowerCase());
    if (debugOn) {
      console.log('[recap/debug] system_prompt\n', systemPrompt);
      console.log('[recap/debug] user_prompt\n', userPrompt);
    }

    const model = getRecapModel();
    const reqBody = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };
    if (modelSupportsTemperature(model)) reqBody.temperature = temperature;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(500).json({ error: err?.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
    const raw = extractAssistantText(data);
    if (!raw) {
      const types = Array.isArray(data.content) ? data.content.map((c) => c.type).join(',') : 'none';
      console.error('[recap/generate] empty text', `stop=${data.stop_reason || '?'} blocks=[${types}]`);
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    // App builds H1 + session line; model may supply ## subtitle then body.
    const { subtitle, body } = parseModelRecapOutput(raw);
    const content = assembleRecapMarkdown({
      tone: t,
      worldTitle: sources.world_title,
      campaignTitle: sources.campaign_title,
      sessionNumber: sources.session_number,
      subtitle,
      body,
    });

    insertRecapAndRespond(session_id, session.folder_id, uid, t, content, req, res, sources);
  } catch (e) {
    console.error('[recap/generate]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /recaps/:id ────────────────────────────────────────────────────────
// Edit recap content (author, DM, or admin). Does not consume generation quota.
router.put('/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const uid = req.user.id;
  const { content } = req.body || {};

  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid recap id' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const trimmed = content.trim();
  if (!trimmed) return res.status(400).json({ error: 'content cannot be empty' });

  const recap = db.prepare('SELECT * FROM recaps WHERE id = ?').get(id);
  if (!recap) return res.status(404).json({ error: 'Recap not found' });

  if (!canEditRecap(uid, recap)) {
    return res.status(403).json({ error: 'Only the author, a campaign DM, or an admin can edit this recap.' });
  }

  if (recap.folder_id != null) {
    const demoMsg = demoMutateForbiddenMessage(uid, recap.folder_id);
    if (demoMsg) return res.status(403).json({ error: demoMsg });
  }

  db.prepare(`
    UPDATE recaps SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(trimmed, id);

  const updated = db.prepare(
    'SELECT r.*, u.username as author FROM recaps r JOIN users u ON u.id = r.generated_by WHERE r.id = ?'
  ).get(id);

  if (req.app.broadcast) {
    req.app.broadcast({ type: 'recap_updated', session_id: recap.session_id, recap_id: id, updated_by: uid });
  }

  res.json({ recap: updated });
});

// ── GET /recaps/folder-roles/:folderId ─────────────────────────────────────
// Returns DMs for a folder (for admin/DM management)
router.get('/folder-roles/:folderId', authenticateToken, (req, res) => {
  const folderId = parseInt(req.params.folderId);
  const uid = req.user.id;
  const admin = isAdmin(uid);
  const rootId = getRootFolderId(folderId);
  const dm = !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(rootId, uid);

  if (!admin && !dm) return res.status(403).json({ error: 'Only DMs and admins can view folder roles' });

  const roles = db.prepare(`
    SELECT fr.*, u.username FROM folder_roles fr
    JOIN users u ON u.id = fr.user_id
    WHERE fr.folder_id = ?
  `).all(rootId);

  res.json({ roles, root_folder_id: rootId });
});

// ── POST /recaps/folder-roles/:folderId ────────────────────────────────────
// Add or remove a DM from a campaign folder
router.post('/folder-roles/:folderId', authenticateToken, (req, res) => {
  const folderId = parseInt(req.params.folderId);
  const { user_id, action } = req.body; // action: 'add' | 'remove'
  const uid = req.user.id;
  const admin = isAdmin(uid);
  const rootId = getRootFolderId(folderId);
  const dm = !!db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(rootId, uid);

  if (!admin && !dm) return res.status(403).json({ error: 'Only DMs and admins can manage folder roles' });

  const dmRoles = demoMutateForbiddenMessage(uid, rootId);
  if (dmRoles) return res.status(403).json({ error: dmRoles });

  // Prevent removing the last DM
  if (action === 'remove') {
    const dmCount = db.prepare("SELECT COUNT(*) as c FROM folder_roles WHERE folder_id = ? AND role = 'dm'").get(rootId).c;
    if (dmCount <= 1) return res.status(400).json({ error: 'Cannot remove the last DM from a campaign.' });
    db.prepare("DELETE FROM folder_roles WHERE folder_id = ? AND user_id = ?").run(rootId, user_id);
  } else {
    db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(rootId, user_id);
  }

  const roles = db.prepare(`
    SELECT fr.*, u.username FROM folder_roles fr
    JOIN users u ON u.id = fr.user_id
    WHERE fr.folder_id = ?
  `).all(rootId);

  res.json({ roles });
});

module.exports = router;
