/**
 * Glossary API: CRUD, suggestions, scan, merge into world / detach.
 */
const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const {
  isAdmin,
  isGrantedUser,
  isPlayableCampaignRoot,
  getRootFolderId,
  isWorldMember,
  canAccessCampaignScope,
  isNoteInWorldOnlyScope,
  isNoteInPlayableCampaignScope,
  getCampaignFolderId,
} = require('../utils/access');
const { demoMutateForbiddenMessage } = require('../utils/demoAccess');
const {
  ensureGlossaryForScope,
  getGlossaryById,
  getGlossaryByScopeNoteId,
  isGlossaryEditor,
  isGlossaryScopeRoot,
  upsertApprovedEntry,
  upsertAlias,
  findEntryByName,
  findAliasByName,
  isValidType,
  normalizeName,
  deleteGlossaryAndStub,
  getTopLevelScopeForNote,
} = require('../utils/glossary');
const { scanSessionGlossary } = require('../utils/glossaryScan');

const router = express.Router();

function canViewScopeNote(noteId, userId) {
  if (isAdmin(userId)) return true;
  const note = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(noteId);
  if (!note) return false;
  if (isNoteInWorldOnlyScope(noteId)) {
    const worldId = getRootFolderId(noteId);
    if (!worldId || !isWorldMember(worldId, userId)) return false;
  } else if (isNoteInPlayableCampaignScope(noteId)) {
    const campaignId = getCampaignFolderId(noteId);
    if (!campaignId || !canAccessCampaignScope(campaignId, userId)) return false;
  }
  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;
  return isGrantedUser(noteId, userId);
}

function canViewGlossary(userId, glossary) {
  if (!glossary) return false;
  return canViewScopeNote(glossary.scope_note_id, userId);
}

function canReviewSuggestions(userId, glossary) {
  if (isGlossaryEditor(userId, glossary.id)) return true;
  return !!glossary.players_can_review_suggestions && canViewGlossary(userId, glossary);
}

function loadEntryBundle(entryId) {
  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(entryId);
  if (!entry) return null;
  const aliases = db.prepare(`
    SELECT * FROM glossary_entry_aliases WHERE entry_id = ? ORDER BY alias ASC
  `).all(entryId);
  return { ...entry, aliases };
}

// GET /glossary/by-scope/:scopeNoteId
router.get('/by-scope/:scopeNoteId', authenticateToken, (req, res) => {
  const scopeNoteId = parseInt(req.params.scopeNoteId, 10);
  if (!isGlossaryScopeRoot(scopeNoteId)) {
    return res.status(400).json({ error: 'Not a glossary scope (World or standalone Campaign)' });
  }
  const { glossary, note } = ensureGlossaryForScope(scopeNoteId);
  if (!canViewGlossary(req.user.id, glossary)) return res.status(403).json({ error: 'Forbidden' });

  const entries = db.prepare(`
    SELECT * FROM glossary_entries WHERE glossary_id = ? ORDER BY type ASC, name ASC
  `).all(glossary.id).map((e) => loadEntryBundle(e.id));

  const suggestedAliases = db.prepare(`
    SELECT a.*, e.name AS entry_name
    FROM glossary_entry_aliases a
    JOIN glossary_entries e ON e.id = a.entry_id
    WHERE a.glossary_id = ? AND a.status = 'suggested'
    ORDER BY a.alias ASC
  `).all(glossary.id);

  res.json({
    glossary,
    note_id: note.id,
    can_edit: isGlossaryEditor(req.user.id, glossary.id),
    can_review_suggestions: canReviewSuggestions(req.user.id, glossary),
    entries,
    suggested_aliases: suggestedAliases,
  });
});

// PATCH /glossary/:id/settings
router.patch('/:id/settings', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const glossary = getGlossaryById(id);
  if (!glossary) return res.status(404).json({ error: 'Not found' });
  if (!isGlossaryEditor(req.user.id, id)) return res.status(403).json({ error: 'Forbidden' });
  const demo = demoMutateForbiddenMessage(req.user.id, glossary.scope_note_id);
  if (demo) return res.status(403).json({ error: demo });

  if (req.body.players_can_review_suggestions !== undefined) {
    db.prepare('UPDATE glossaries SET players_can_review_suggestions = ? WHERE id = ?').run(
      req.body.players_can_review_suggestions ? 1 : 0,
      id
    );
  }
  res.json(getGlossaryById(id));
});

// POST /glossary/:id/entries — create approved (reactivates dismissed)
router.post('/:id/entries', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const glossary = getGlossaryById(id);
  if (!glossary) return res.status(404).json({ error: 'Not found' });
  if (!isGlossaryEditor(req.user.id, id)) return res.status(403).json({ error: 'Forbidden' });
  const demo = demoMutateForbiddenMessage(req.user.id, glossary.scope_note_id);
  if (demo) return res.status(403).json({ error: demo });

  try {
    const { entry } = upsertApprovedEntry(id, {
      name: req.body.name,
      type: req.body.type,
      description: req.body.description,
      campaign_id: req.body.campaign_id ?? null,
    });
    const aliases = Array.isArray(req.body.aliases) ? req.body.aliases : [];
    for (const a of aliases) {
      try { upsertAlias(id, entry.id, a, 'approved'); } catch { /* skip bad */ }
    }
    res.status(201).json(loadEntryBundle(entry.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /glossary/entries/:entryId
router.put('/entries/:entryId', authenticateToken, (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(entryId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (!isGlossaryEditor(req.user.id, entry.glossary_id)) return res.status(403).json({ error: 'Forbidden' });
  const glossary = getGlossaryById(entry.glossary_id);
  const demo = demoMutateForbiddenMessage(req.user.id, glossary.scope_note_id);
  if (demo) return res.status(403).json({ error: demo });

  const name = req.body.name !== undefined ? normalizeName(req.body.name) : entry.name;
  const type = req.body.type !== undefined ? req.body.type : entry.type;
  const description = req.body.description !== undefined ? String(req.body.description) : entry.description;
  const status = req.body.status !== undefined ? req.body.status : entry.status;
  const campaign_id = req.body.campaign_id !== undefined ? req.body.campaign_id : entry.campaign_id;

  if (!isValidType(type)) return res.status(400).json({ error: 'invalid type' });
  if (!['approved', 'suggested', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }

  if (name.toLowerCase() !== entry.name.toLowerCase()) {
    const clash = findEntryByName(entry.glossary_id, name);
    if (clash && clash.id !== entry.id) {
      if (clash.status === 'dismissed') {
        db.prepare('DELETE FROM glossary_entries WHERE id = ?').run(clash.id);
      } else {
        return res.status(409).json({ error: 'Name already exists' });
      }
    }
    const aliasClash = findAliasByName(entry.glossary_id, name);
    if (aliasClash) return res.status(409).json({ error: 'Name matches an alias' });
  }

  db.prepare(`
    UPDATE glossary_entries
    SET name = ?, type = ?, description = ?, status = ?, campaign_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, type, description, status, campaign_id, entryId);

  if (Array.isArray(req.body.aliases)) {
    const want = req.body.aliases.map(normalizeName).filter(Boolean);
    const current = db.prepare(`
      SELECT * FROM glossary_entry_aliases WHERE entry_id = ? AND status = 'approved'
    `).all(entryId);
    for (const c of current) {
      if (!want.some((w) => w.toLowerCase() === c.alias.toLowerCase())) {
        db.prepare('DELETE FROM glossary_entry_aliases WHERE id = ?').run(c.id);
      }
    }
    for (const w of want) {
      try { upsertAlias(entry.glossary_id, entryId, w, 'approved'); } catch { /* ignore */ }
    }
  }

  res.json(loadEntryBundle(entryId));
});

// POST /glossary/entries/:entryId/accept
router.post('/entries/:entryId/accept', authenticateToken, (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(entryId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const glossary = getGlossaryById(entry.glossary_id);
  if (!canReviewSuggestions(req.user.id, glossary)) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`
    UPDATE glossary_entries SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(entryId);
  res.json(loadEntryBundle(entryId));
});

// POST /glossary/entries/:entryId/dismiss
router.post('/entries/:entryId/dismiss', authenticateToken, (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(entryId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const glossary = getGlossaryById(entry.glossary_id);
  if (!canReviewSuggestions(req.user.id, glossary)) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`
    UPDATE glossary_entries SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(entryId);
  res.json(loadEntryBundle(entryId));
});

// DELETE /glossary/entries/:entryId
router.delete('/entries/:entryId', authenticateToken, (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(entryId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (!isGlossaryEditor(req.user.id, entry.glossary_id)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM glossary_entries WHERE id = ?').run(entryId);
  res.json({ ok: true });
});

// POST /glossary/aliases/:aliasId/accept
router.post('/aliases/:aliasId/accept', authenticateToken, (req, res) => {
  const aliasId = parseInt(req.params.aliasId, 10);
  const row = db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(aliasId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const glossary = getGlossaryById(row.glossary_id);
  if (!canReviewSuggestions(req.user.id, glossary)) return res.status(403).json({ error: 'Forbidden' });

  // Reactivate if another dismissed alias somehow — this row is the suggestion
  try {
    const result = upsertAlias(row.glossary_id, row.entry_id, row.alias, 'approved');
    // upsert may create new or update; delete duplicate suggestion if different id
    if (result.alias.id !== aliasId) {
      db.prepare('DELETE FROM glossary_entry_aliases WHERE id = ?').run(aliasId);
    }
    res.json(result.alias);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /glossary/aliases/:aliasId/dismiss
router.post('/aliases/:aliasId/dismiss', authenticateToken, (req, res) => {
  const aliasId = parseInt(req.params.aliasId, 10);
  const row = db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(aliasId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const glossary = getGlossaryById(row.glossary_id);
  if (!canReviewSuggestions(req.user.id, glossary)) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`UPDATE glossary_entry_aliases SET status = 'dismissed' WHERE id = ?`).run(aliasId);
  res.json(db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(aliasId));
});

// POST /glossary/scan/:sessionId
router.post('/scan/:sessionId', authenticateToken, async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.folder_id) return res.status(404).json({ error: 'Session not found' });
  const scopeId = getTopLevelScopeForNote(session.folder_id);
  if (!scopeId) return res.status(400).json({ error: 'No glossary scope' });
  const { glossary } = ensureGlossaryForScope(scopeId);
  if (!isGlossaryEditor(req.user.id, glossary.id)) return res.status(403).json({ error: 'Forbidden' });

  const result = await scanSessionGlossary(sessionId, { retry: false });
  if (!result.ok) return res.status(500).json({ error: result.error || 'Scan failed, try again' });
  res.json(result);
});

// POST /glossary/:id/build-from-past
router.post('/:id/build-from-past', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const glossary = getGlossaryById(id);
  if (!glossary) return res.status(404).json({ error: 'Not found' });
  if (!isGlossaryEditor(req.user.id, id)) return res.status(403).json({ error: 'Forbidden' });

  const scope = db.prepare('SELECT * FROM notes WHERE id = ?').get(glossary.scope_note_id);
  let folderIds = [scope.id];
  if (scope.is_world) {
    const camps = db.prepare(`
      SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL AND is_folder = 1
    `).all(scope.id).filter((c) => isPlayableCampaignRoot(c.id)).map((c) => c.id);
    folderIds = camps.length ? camps : folderIds;
  }

  const sessions = db.prepare(`
    SELECT id FROM sessions WHERE folder_id IN (${folderIds.map(() => '?').join(',')}) ORDER BY id ASC
  `).all(...folderIds);

  let added_entries = 0;
  let added_aliases = 0;
  const errors = [];
  for (const s of sessions) {
    const r = await scanSessionGlossary(s.id, { retry: true });
    if (r.ok) {
      added_entries += r.added_entries;
      added_aliases += r.added_aliases;
    } else {
      errors.push({ session_id: s.id, error: r.error });
    }
  }
  res.json({ ok: true, sessions: sessions.length, added_entries, added_aliases, errors });
});

// POST /glossary/merge-preview { campaign_id, world_id }
router.post('/merge-preview', authenticateToken, (req, res) => {
  const campaignId = parseInt(req.body.campaign_id, 10);
  const worldId = parseInt(req.body.world_id, 10);
  const campaign = db.prepare('SELECT * FROM notes WHERE id = ?').get(campaignId);
  const world = db.prepare('SELECT * FROM notes WHERE id = ?').get(worldId);
  if (!campaign || !world?.is_world || world.parent_id != null) {
    return res.status(400).json({ error: 'Invalid campaign or world' });
  }
  if (campaign.parent_id != null) return res.status(400).json({ error: 'Campaign must be a root to move under a world' });
  if (!isGlossaryEditor(req.user.id, getGlossaryByScopeNoteId(campaignId)?.id || -1)
    && !isAdmin(req.user.id)
    && campaign.user_id !== req.user.id) {
    // allow if can manage campaign
  }
  if (!isAdmin(req.user.id) && campaign.user_id !== req.user.id && !isGlossaryEditor(req.user.id, getGlossaryByScopeNoteId(worldId)?.id || 0)) {
    const cg = getGlossaryByScopeNoteId(campaignId);
    if (!cg || !isGlossaryEditor(req.user.id, cg.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const srcG = ensureGlossaryForScope(campaignId).glossary;
  const dstG = ensureGlossaryForScope(worldId).glossary;
  const srcEntries = db.prepare(`SELECT * FROM glossary_entries WHERE glossary_id = ?`).all(srcG.id);

  const autoAdds = [];
  const conflicts = [];

  for (const e of srcEntries) {
    if (e.status === 'dismissed') continue;
    const aliases = db.prepare(`SELECT * FROM glossary_entry_aliases WHERE entry_id = ?`).all(e.id);
    const nameClash = findEntryByName(dstG.id, e.name);
    const aliasClashes = [];
    for (const a of aliases) {
      if (a.status === 'dismissed') continue;
      const hit = findAliasByName(dstG.id, a.alias) || findEntryByName(dstG.id, a.alias);
      if (hit) aliasClashes.push({ alias: a.alias, hit });
    }
    if (nameClash || aliasClashes.length) {
      conflicts.push({
        campaign_entry: { ...e, aliases },
        world_entry: nameClash ? loadEntryBundle(nameClash.id) : null,
        alias_clashes: aliasClashes,
      });
    } else {
      autoAdds.push({ ...e, aliases });
    }
  }

  res.json({
    campaign_glossary_id: srcG.id,
    world_glossary_id: dstG.id,
    auto_adds: autoAdds,
    conflicts,
  });
});

// POST /glossary/merge-apply — single transaction
router.post('/merge-apply', authenticateToken, (req, res) => {
  const campaignId = parseInt(req.body.campaign_id, 10);
  const worldId = parseInt(req.body.world_id, 10);
  const resolutions = Array.isArray(req.body.resolutions) ? req.body.resolutions : [];
  // resolutions: [{ campaign_entry_id, action: 'keep_world'|'keep_campaign'|'combine' }]

  const campaign = db.prepare('SELECT * FROM notes WHERE id = ?').get(campaignId);
  const world = db.prepare('SELECT * FROM notes WHERE id = ?').get(worldId);
  if (!campaign || !world?.is_world) return res.status(400).json({ error: 'Invalid campaign or world' });

  const srcG = getGlossaryByScopeNoteId(campaignId);
  const dstG = ensureGlossaryForScope(worldId).glossary;
  if (!srcG) return res.status(400).json({ error: 'Campaign has no glossary' });

  if (!isAdmin(req.user.id) && campaign.user_id !== req.user.id && !isGlossaryEditor(req.user.id, srcG.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const resolutionMap = new Map(resolutions.map((r) => [r.campaign_entry_id, r.action]));

  try {
    const run = db.transaction(() => {
      const srcEntries = db.prepare(`SELECT * FROM glossary_entries WHERE glossary_id = ?`).all(srcG.id);

      for (const e of srcEntries) {
        if (e.status === 'dismissed') continue;
        const aliases = db.prepare(`SELECT * FROM glossary_entry_aliases WHERE entry_id = ?`).all(e.id)
          .filter((a) => a.status !== 'dismissed');
        const nameClash = findEntryByName(dstG.id, e.name);
        const action = resolutionMap.get(e.id) || (nameClash ? 'keep_world' : 'add');

        if (!nameClash && action === 'add') {
          const { entry } = upsertApprovedEntry(dstG.id, {
            name: e.name,
            type: e.type,
            description: e.description,
            campaign_id: campaignId,
          });
          // If was suggested, force approved with campaign tag
          db.prepare(`
            UPDATE glossary_entries SET status = ?, campaign_id = ?, type = ?, description = ? WHERE id = ?
          `).run(e.status === 'suggested' ? 'suggested' : 'approved', campaignId, e.type, e.description, entry.id);
          for (const a of aliases) {
            upsertAlias(dstG.id, entry.id, a.alias, a.status === 'suggested' ? 'suggested' : 'approved');
          }
          continue;
        }

        if (action === 'keep_world') continue;

        if (action === 'keep_campaign' && nameClash) {
          db.prepare(`
            UPDATE glossary_entries
            SET name = ?, type = ?, description = ?, status = 'approved', campaign_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(e.name, e.type, e.description, campaignId, nameClash.id);
          for (const a of aliases) {
            try { upsertAlias(dstG.id, nameClash.id, a.alias, 'approved'); } catch { /* */ }
          }
          continue;
        }

        if (action === 'combine' && nameClash) {
          const desc = [nameClash.description, e.description].filter(Boolean).join(' / ');
          db.prepare(`
            UPDATE glossary_entries SET description = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(desc, nameClash.id);
          for (const a of aliases) {
            try { upsertAlias(dstG.id, nameClash.id, a.alias, 'approved'); } catch { /* */ }
          }
          continue;
        }

        // no clash — add with campaign_id
        if (!nameClash) {
          const ins = db.prepare(`
            INSERT INTO glossary_entries (glossary_id, name, type, description, status, campaign_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(dstG.id, e.name, e.type, e.description, e.status === 'suggested' ? 'suggested' : 'approved', campaignId);
          for (const a of aliases) {
            db.prepare(`
              INSERT OR IGNORE INTO glossary_entry_aliases (glossary_id, entry_id, alias, status)
              VALUES (?, ?, ?, ?)
            `).run(dstG.id, ins.lastInsertRowid, a.alias, a.status === 'suggested' ? 'suggested' : 'approved');
          }
        }
      }

      deleteGlossaryAndStub(srcG.id);

      // Move campaign under world (same as notes PUT parent_id)
      db.prepare(`UPDATE notes SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(worldId, campaignId);

      // Inherit world grants onto campaign (lightweight; full cascade happens on normal moves — mirror essentials)
      const worldGrants = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(worldId);
      const grantIns = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
      for (const g of worldGrants) grantIns.run(campaignId, g.user_id);
    });
    run();
  } catch (e) {
    console.error('[glossary/merge-apply]', e);
    return res.status(500).json({ error: e.message || 'Merge failed' });
  }

  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
  res.json({ ok: true });
});

// POST /glossary/detach-campaign { campaign_id } — after or with un-parent; call when leaving world
router.post('/detach-campaign', authenticateToken, (req, res) => {
  const campaignId = parseInt(req.body.campaign_id, 10);
  const campaign = db.prepare('SELECT * FROM notes WHERE id = ?').get(campaignId);
  if (!campaign || !isPlayableCampaignRoot(campaignId)) {
    return res.status(400).json({ error: 'Not a campaign' });
  }
  // Expect campaign already at root OR still under world — if under world, we copy then caller moves
  const worldId = campaign.parent_id ? getRootFolderId(campaignId) : null;
  const world = worldId ? db.prepare('SELECT * FROM notes WHERE id = ?').get(worldId) : null;
  if (!world?.is_world) {
    // Already standalone — ensure glossary only
    const { glossary, note } = ensureGlossaryForScope(campaignId);
    return res.json({ glossary, note_id: note.id });
  }

  if (!isAdmin(req.user.id) && campaign.user_id !== req.user.id) {
    const wg = getGlossaryByScopeNoteId(worldId);
    if (!wg || !isGlossaryEditor(req.user.id, wg.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  try {
    const run = db.transaction(() => {
      // Ensure campaign is root first if still under world
      if (campaign.parent_id != null) {
        db.prepare('UPDATE notes SET parent_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(campaignId);
      }

      const { glossary } = ensureGlossaryForScope(campaignId);
      const worldG = getGlossaryByScopeNoteId(worldId);
      if (!worldG) return;

      // Copy campaign-tagged entries
      const tagged = db.prepare(`
        SELECT * FROM glossary_entries WHERE glossary_id = ? AND campaign_id = ? AND status = 'approved'
      `).all(worldG.id, campaignId);

      // Journal mention text for this campaign
      const journalBlob = db.prepare(`
        SELECT GROUP_CONCAT(je.content, ' ') AS t
        FROM journal_entries je
        JOIN sessions s ON s.id = je.session_id
        WHERE s.folder_id = ? AND je.is_session_break = 0
      `).get(campaignId)?.t || '';
      const blobLower = journalBlob.toLowerCase();

      const worldApproved = db.prepare(`
        SELECT * FROM glossary_entries WHERE glossary_id = ? AND status = 'approved'
      `).all(worldG.id);

      const copyEntry = (e) => {
        const existing = findEntryByName(glossary.id, e.name);
        if (existing) return;
        const ins = db.prepare(`
          INSERT INTO glossary_entries (glossary_id, name, type, description, status, campaign_id)
          VALUES (?, ?, ?, ?, 'approved', NULL)
        `).run(glossary.id, e.name, e.type, e.description);
        const aliases = db.prepare(`
          SELECT * FROM glossary_entry_aliases WHERE entry_id = ? AND status = 'approved'
        `).all(e.id);
        for (const a of aliases) {
          db.prepare(`
            INSERT OR IGNORE INTO glossary_entry_aliases (glossary_id, entry_id, alias, status)
            VALUES (?, ?, ?, 'approved')
          `).run(glossary.id, ins.lastInsertRowid, a.alias);
        }
      };

      for (const e of tagged) copyEntry(e);

      for (const e of worldApproved) {
        if (e.campaign_id && e.campaign_id !== campaignId) continue;
        if (tagged.some((t) => t.id === e.id)) continue;
        const aliases = db.prepare(`
          SELECT alias FROM glossary_entry_aliases WHERE entry_id = ? AND status = 'approved'
        `).all(e.id).map((a) => a.alias);
        const terms = [e.name, ...aliases];
        if (terms.some((t) => blobLower.includes(String(t).toLowerCase()))) {
          copyEntry(e);
        }
      }

      return glossary;
    });
    const glossary = run();
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    res.json({ ok: true, glossary });
  } catch (e) {
    console.error('[glossary/detach]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
