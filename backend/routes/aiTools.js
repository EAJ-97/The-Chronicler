/**
 * AI tools: Lore So Far (per-user cache), NPC generator, continuity report (DM-only note).
 */

const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, isDMOf, isGrantedUser, isNoteUnderCompletedArchive, isWorldOrCampaignRootFolder } = require('../utils/access');
const { buildLoreCorpus, buildJournalCorpusText, buildAttachmentContextFromPrompt } = require('../utils/aiCorpus');
const {
  loreSoFarPrompts,
  npcGeneratorPrompts,
  locationGeneratorPrompts,
  itemGeneratorPrompts,
  continuityPrompts,
  playerLoreSummaryPrompts,
} = require('../utils/aiPrompts');

const router = express.Router();

const CONTINUITY_NOTE_TITLE = 'AI Continuity Report';

/**
 * True if user can access journal folder (same rules as journal route).
 * @param {number} uid
 * @param {number|null} folderId
 * @param {boolean} admin
 */
function canAccessFolder(uid, folderId, admin) {
  if (!folderId || admin) return true;
  const folder = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(folderId);
  if (!folder) return true;
  if (folder.user_id === uid) return true;
  if (folder.visibility !== 'hidden') return true;
  return !!db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(folderId, uid);
}

/**
 * @returns {boolean}
 */
function isAiGloballyEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  return row?.value === 'true';
}

/**
 * Mirrors notes route visibility for a single note (for summarize).
 * @param {number} noteId
 * @param {number} userId
 * @param {boolean} adminUser
 */
function canSeeNoteForAi(noteId, userId, adminUser) {
  if (adminUser) return true;
  const note = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) return false;
  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;
  return isGrantedUser(noteId, userId);
}

/**
 * @returns {string|null}
 */
function getAnthropicApiKey() {
  return db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get()?.value?.trim() || null;
}

/**
 * Calls Anthropic Messages API.
 * @param {string} system
 * @param {string} user
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
async function callAnthropic(system, user, maxTokens = 4096) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error('No Anthropic API key configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Anthropic API error');
  }
  const data = await response.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from AI');
  return text;
}

// ── Lore So Far (any user with journal access) ──────────────────────────────

/**
 * GET cached lore for this user + campaign folder.
 */
router.get('/lore/:campaignId', authenticateToken, (req, res) => {
  const campaignId = parseInt(req.params.campaignId, 10);
  if (!Number.isFinite(campaignId)) return res.status(400).json({ error: 'Invalid campaign id' });
  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canAccessFolder(uid, campaignId, admin)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const row = db
    .prepare('SELECT content, updated_at FROM ai_lore_cache WHERE user_id = ? AND campaign_id = ?')
    .get(uid, campaignId);
  res.json({ content: row?.content || '', updated_at: row?.updated_at || null });
});

/**
 * POST generate lore from corpus; optional save to cache.
 * Body: { save?: boolean }
 */
router.post('/lore/:campaignId/generate', authenticateToken, async (req, res) => {
  const campaignId = parseInt(req.params.campaignId, 10);
  const save = !!req.body?.save;
  if (!Number.isFinite(campaignId)) return res.status(400).json({ error: 'Invalid campaign id' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });
  if (!canAccessFolder(uid, campaignId, admin)) return res.status(403).json({ error: 'Access denied' });
  if (!admin && isNoteUnderCompletedArchive(campaignId)) {
    return res.status(403).json({ error: 'Lore So Far generation is disabled while this campaign or world is marked completed.' });
  }

  const folder = db.prepare('SELECT title FROM notes WHERE id = ? AND is_folder = 1 AND deleted_at IS NULL').get(campaignId);
  if (!folder) return res.status(400).json({ error: 'Campaign folder not found' });

  try {
    const { corpusUser, noteCount, refCount } = buildLoreCorpus(campaignId, uid, admin);
    const journalLen = (buildJournalCorpusText(campaignId) || '').trim().length;
    if (noteCount === 0 && journalLen === 0) {
      return res.status(400).json({ error: 'No visible notes or journal content to summarize yet.' });
    }

    const { system, user } = loreSoFarPrompts(corpusUser, folder.title);
    const content = await callAnthropic(system, user, 4096);

    if (save) {
      db.prepare(
        `
        INSERT INTO ai_lore_cache (user_id, campaign_id, content, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, campaign_id) DO UPDATE SET
          content = excluded.content,
          updated_at = CURRENT_TIMESTAMP
      `
      ).run(uid, campaignId, content);
    }

    const row = db
      .prepare('SELECT updated_at FROM ai_lore_cache WHERE user_id = ? AND campaign_id = ?')
      .get(uid, campaignId);
    res.json({ content, saved: save, updated_at: row?.updated_at || null, meta: { noteCount, refCount } });
  } catch (e) {
    console.error('[ai/lore/generate]', e);
    res.status(500).json({ error: e.message || 'Generation failed' });
  }
});

/**
 * PUT save lore text manually.
 * Body: { content: string }
 */
router.put('/lore/:campaignId', authenticateToken, (req, res) => {
  const campaignId = parseInt(req.params.campaignId, 10);
  const content = req.body?.content != null ? String(req.body.content) : '';
  if (!Number.isFinite(campaignId)) return res.status(400).json({ error: 'Invalid campaign id' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!canAccessFolder(uid, campaignId, admin)) return res.status(403).json({ error: 'Access denied' });
  if (!admin && isNoteUnderCompletedArchive(campaignId)) {
    return res.status(403).json({ error: 'Saving lore cache is disabled while this campaign or world is marked completed.' });
  }

  db.prepare(
    `
    INSERT INTO ai_lore_cache (user_id, campaign_id, content, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, campaign_id) DO UPDATE SET
      content = excluded.content,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(uid, campaignId, content);

  const row = db
    .prepare('SELECT updated_at FROM ai_lore_cache WHERE user_id = ? AND campaign_id = ?')
    .get(uid, campaignId);
  res.json({ success: true, updated_at: row?.updated_at });
});

/**
 * POST per-note player lore summary — only when note sits under a completed world/campaign.
 */
router.post('/summarize/:noteId', authenticateToken, async (req, res) => {
  const noteId = parseInt(req.params.noteId, 10);
  if (!Number.isFinite(noteId)) return res.status(400).json({ error: 'Invalid note id' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });

  if (!isNoteUnderCompletedArchive(noteId)) {
    return res.status(403).json({
      error: 'Lore summary is only available when the campaign or world is marked completed.',
    });
  }

  if (!canSeeNoteForAi(noteId, uid, admin)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note || note.is_folder) {
    return res.status(400).json({ error: 'Only notes can be summarized' });
  }

  if (note.is_dm_only && !admin && !isDMOf(noteId, uid)) {
    return res.status(403).json({ error: 'DM-only notes cannot be summarized for players.' });
  }

  const bodyText = note.content || '';
  try {
    const { system, user } = playerLoreSummaryPrompts(note.title, bodyText);
    const summary = await callAnthropic(system, user, 1024);
    res.json({ summary });
  } catch (e) {
    console.error('[ai/summarize]', e);
    res.status(500).json({ error: e.message || 'Summarization failed' });
  }
});

// ── NPC Generator (DM or admin) ─────────────────────────────────────────────

/**
 * POST create NPC note under parent folder.
 * Body: { parent_id, prompt, category?: 'npc'|'character', is_dm_only?: boolean }
 */
router.post('/npc-generate', authenticateToken, async (req, res) => {
  const { parent_id, prompt, category = 'npc', is_dm_only = false } = req.body || {};
  const pid = parseInt(parent_id, 10);
  if (!Number.isFinite(pid)) return res.status(400).json({ error: 'parent_id required' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });

  const parent = db.prepare('SELECT id, is_folder, user_id, visibility FROM notes WHERE id = ? AND deleted_at IS NULL').get(pid);
  if (!parent || !parent.is_folder) return res.status(400).json({ error: 'parent_id must be a folder' });

  if (!admin && !isDMOf(pid, uid)) {
    return res.status(403).json({ error: 'Only DMs or admins can generate NPC notes here' });
  }
  if (!admin && isNoteUnderCompletedArchive(pid)) {
    return res.status(403).json({ error: 'AI generation is disabled while this campaign or world is marked completed.' });
  }

  const cat = category === 'character' ? 'character' : 'npc';
  const dmOnly = !!is_dm_only;

  try {
    const attachmentContext = buildAttachmentContextFromPrompt(String(prompt), uid, admin);
    const { system, user } = npcGeneratorPrompts(String(prompt).trim(), { dm_only: dmOnly, attachmentContext });
    const markdown = await callAnthropic(system, user, 8192);

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : 'Generated NPC';

    const visibility = parent.visibility || 'hidden';
    const result = db
      .prepare(
        `
      INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility, is_dm_only)
      VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)
    `
      )
      .run(uid, pid, title, markdown, cat, visibility, dmOnly ? 1 : 0);

    const noteId = result.lastInsertRowid;
    const inherited = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(pid).map((r) => r.user_id);
    const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    inherited.forEach((g) => grantInsert.run(noteId, g));

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    res.status(201).json({ note });
  } catch (e) {
    console.error('[ai/npc-generate]', e);
    res.status(500).json({ error: e.message || 'NPC generation failed' });
  }
});

/**
 * POST create location note under parent folder (DM/admin). Body like npc-generate; category fixed to location.
 */
router.post('/location-generate', authenticateToken, async (req, res) => {
  const { parent_id, prompt, is_dm_only = false } = req.body || {};
  const pid = parseInt(parent_id, 10);
  if (!Number.isFinite(pid)) return res.status(400).json({ error: 'parent_id required' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });

  const parent = db.prepare('SELECT id, is_folder, user_id, visibility FROM notes WHERE id = ? AND deleted_at IS NULL').get(pid);
  if (!parent || !parent.is_folder) return res.status(400).json({ error: 'parent_id must be a folder' });

  if (!admin && !isDMOf(pid, uid)) {
    return res.status(403).json({ error: 'Only DMs or admins can generate location notes here' });
  }
  if (!admin && isNoteUnderCompletedArchive(pid)) {
    return res.status(403).json({ error: 'AI generation is disabled while this campaign or world is marked completed.' });
  }

  const dmOnly = !!is_dm_only;

  try {
    const attachmentContext = buildAttachmentContextFromPrompt(String(prompt), uid, admin);
    const { system, user } = locationGeneratorPrompts(String(prompt).trim(), { dm_only: dmOnly, attachmentContext });
    const markdown = await callAnthropic(system, user, 8192);

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : 'Generated Location';

    const visibility = parent.visibility || 'hidden';
    const result = db
      .prepare(
        `
      INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility, is_dm_only)
      VALUES (?, ?, ?, ?, 0, 0, 'location', 0, ?, ?)
    `
      )
      .run(uid, pid, title, markdown, visibility, dmOnly ? 1 : 0);

    const noteId = result.lastInsertRowid;
    const inherited = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(pid).map((r) => r.user_id);
    const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    inherited.forEach((g) => grantInsert.run(noteId, g));

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    res.status(201).json({ note });
  } catch (e) {
    console.error('[ai/location-generate]', e);
    res.status(500).json({ error: e.message || 'Location generation failed' });
  }
});

/**
 * POST create item/artifact note under parent folder (DM/admin).
 */
router.post('/item-generate', authenticateToken, async (req, res) => {
  const { parent_id, prompt, is_dm_only = false } = req.body || {};
  const pid = parseInt(parent_id, 10);
  if (!Number.isFinite(pid)) return res.status(400).json({ error: 'parent_id required' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });

  const parent = db.prepare('SELECT id, is_folder, user_id, visibility FROM notes WHERE id = ? AND deleted_at IS NULL').get(pid);
  if (!parent || !parent.is_folder) return res.status(400).json({ error: 'parent_id must be a folder' });

  if (!admin && !isDMOf(pid, uid)) {
    return res.status(403).json({ error: 'Only DMs or admins can generate item notes here' });
  }
  if (!admin && isNoteUnderCompletedArchive(pid)) {
    return res.status(403).json({ error: 'AI generation is disabled while this campaign or world is marked completed.' });
  }

  const dmOnly = !!is_dm_only;

  try {
    const attachmentContext = buildAttachmentContextFromPrompt(String(prompt), uid, admin);
    const { system, user } = itemGeneratorPrompts(String(prompt).trim(), { dm_only: dmOnly, attachmentContext });
    const markdown = await callAnthropic(system, user, 8192);

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : 'Generated Item';

    const visibility = parent.visibility || 'hidden';
    const result = db
      .prepare(
        `
      INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility, is_dm_only)
      VALUES (?, ?, ?, ?, 0, 0, 'item', 0, ?, ?)
    `
      )
      .run(uid, pid, title, markdown, visibility, dmOnly ? 1 : 0);

    const noteId = result.lastInsertRowid;
    const inherited = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(pid).map((r) => r.user_id);
    const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    inherited.forEach((g) => grantInsert.run(noteId, g));

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    res.status(201).json({ note });
  } catch (e) {
    console.error('[ai/item-generate]', e);
    res.status(500).json({ error: e.message || 'Item generation failed' });
  }
});

// ── Continuity (DM or admin) ────────────────────────────────────────────────

/**
 * POST generate continuity report into a DM-only note under folder.
 */
router.post('/continuity/:folderId/generate', authenticateToken, async (req, res) => {
  const folderId = parseInt(req.params.folderId, 10);
  if (!Number.isFinite(folderId)) return res.status(400).json({ error: 'Invalid folder id' });

  const uid = req.user.id;
  const admin = isAdmin(uid);
  if (!isAiGloballyEnabled()) return res.status(503).json({ error: 'AI features are not enabled.' });
  if (!getAnthropicApiKey()) return res.status(503).json({ error: 'No Anthropic API key configured.' });

  const folder = db.prepare('SELECT id, title, is_folder FROM notes WHERE id = ? AND deleted_at IS NULL').get(folderId);
  if (!folder || !folder.is_folder) return res.status(400).json({ error: 'Folder not found' });

  if (!isWorldOrCampaignRootFolder(folderId)) {
    return res.status(400).json({ error: 'Continuity runs only on a world or campaign root folder, not a nested subfolder.' });
  }

  if (!admin && !isDMOf(folderId, uid)) {
    return res.status(403).json({ error: 'Only DMs or admins can run continuity analysis' });
  }
  if (!admin && isNoteUnderCompletedArchive(folderId)) {
    return res.status(403).json({ error: 'Continuity generation is disabled while this campaign or world is marked completed.' });
  }

  try {
    const { corpusUser } = buildLoreCorpus(folderId, uid, admin);
    const { system, user } = continuityPrompts(corpusUser, folder.title);
    const markdown = await callAnthropic(system, user, 8192);

    let reportNote = db
      .prepare(
        `
      SELECT id FROM notes
      WHERE parent_id = ? AND title = ? AND deleted_at IS NULL AND is_dm_only = 1
      LIMIT 1
    `
      )
      .get(folderId, CONTINUITY_NOTE_TITLE);

    if (reportNote) {
      db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(markdown, reportNote.id);
    } else {
      const parent = db.prepare('SELECT visibility FROM notes WHERE id = ?').get(folderId);
      const visibility = parent?.visibility || 'hidden';
      const ins = db
        .prepare(
          `
        INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility, is_dm_only)
        VALUES (?, ?, ?, ?, 0, 0, 'lore', 0, ?, 1)
      `
        )
        .run(uid, folderId, CONTINUITY_NOTE_TITLE, markdown, visibility);
      reportNote = { id: ins.lastInsertRowid };
      const inherited = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(folderId).map((r) => r.user_id);
      const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
      inherited.forEach((g) => grantInsert.run(reportNote.id, g));
    }

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(reportNote.id);
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    res.json({ note, content: markdown });
  } catch (e) {
    console.error('[ai/continuity]', e);
    res.status(500).json({ error: e.message || 'Continuity generation failed' });
  }
});

module.exports = router;
