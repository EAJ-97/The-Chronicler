/**
 * Top-level glossary helpers: one glossary per World or standalone Campaign.
 */
const db = require('../db/database');
const { getRootFolderId, isPlayableCampaignRoot, isAdmin, isDMOfFolder } = require('./access');

const ENTRY_TYPES = new Set(['npc', 'place', 'item', 'faction', 'other']);
const STATUSES = new Set(['approved', 'suggested', 'dismissed']);

function normalizeName(s) {
  return String(s || '').trim();
}

function isValidType(t) {
  return ENTRY_TYPES.has(t);
}

function isValidStatus(s) {
  return STATUSES.has(s);
}

/**
 * True when a note is a glossary scope root: world root or standalone campaign root.
 * @param {number} noteId
 */
function isGlossaryScopeRoot(noteId) {
  const row = db.prepare(
    'SELECT id, parent_id, is_folder, is_world, is_campaign, deleted_at FROM notes WHERE id = ?'
  ).get(noteId);
  if (!row || row.deleted_at || !row.is_folder) return false;
  if (row.parent_id != null) return false;
  if (row.is_world) return true;
  return isPlayableCampaignRoot(noteId);
}

/**
 * All existing scope roots that should have a glossary (for migration backfill).
 * @returns {number[]}
 */
function listGlossaryScopeRoots() {
  const worlds = db.prepare(`
    SELECT id FROM notes
    WHERE is_folder = 1 AND parent_id IS NULL AND deleted_at IS NULL AND is_world = 1
  `).all();
  const standalones = db.prepare(`
    SELECT id FROM notes
    WHERE is_folder = 1 AND parent_id IS NULL AND deleted_at IS NULL
      AND COALESCE(is_world, 0) = 0
      AND (is_campaign = 1 OR is_campaign = 0)
  `).all().filter((r) => isPlayableCampaignRoot(r.id));
  const ids = new Set([...worlds, ...standalones].map((r) => r.id));
  return [...ids];
}

/**
 * Resolve top-level glossary scope for any note: World root, or Campaign itself if standalone.
 * Campaigns under a world use the World as scope.
 * @param {number} noteId
 * @returns {number|null}
 */
function getTopLevelScopeForNote(noteId) {
  const rootId = getRootFolderId(noteId);
  if (!rootId) return null;
  const root = db.prepare('SELECT id, is_world FROM notes WHERE id = ?').get(rootId);
  if (!root) return null;
  return root.id;
}

/**
 * Glossary row for a session's campaign folder (world if under world, else standalone campaign).
 * @param {number} sessionId
 */
function getGlossaryForSession(sessionId) {
  const session = db.prepare('SELECT folder_id FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.folder_id) return null;
  const scopeId = getTopLevelScopeForNote(session.folder_id);
  if (!scopeId) return null;
  return db.prepare('SELECT * FROM glossaries WHERE scope_note_id = ?').get(scopeId) || null;
}

/**
 * Create glossary + locked Glossary stub note if missing.
 * @param {number} scopeNoteId
 * @returns {{ glossary: object, note: object }}
 */
function ensureGlossaryForScope(scopeNoteId) {
  if (!isGlossaryScopeRoot(scopeNoteId)) {
    throw new Error('Glossary scope must be a World or standalone Campaign root');
  }
  const scope = db.prepare('SELECT * FROM notes WHERE id = ?').get(scopeNoteId);
  if (!scope) throw new Error('Scope note not found');

  let glossary = db.prepare('SELECT * FROM glossaries WHERE scope_note_id = ?').get(scopeNoteId);
  if (!glossary) {
    const r = db.prepare(`
      INSERT INTO glossaries (scope_note_id, players_can_review_suggestions)
      VALUES (?, 0)
    `).run(scopeNoteId);
    glossary = db.prepare('SELECT * FROM glossaries WHERE id = ?').get(r.lastInsertRowid);
  }

  let note = db.prepare(`
    SELECT * FROM notes
    WHERE parent_id = ? AND COALESCE(is_glossary, 0) = 1 AND deleted_at IS NULL
    LIMIT 1
  `).get(scopeNoteId);

  if (!note) {
    const ins = db.prepare(`
      INSERT INTO notes (
        user_id, parent_id, title, content, is_shared, is_folder, category,
        sort_order, visibility, is_glossary, is_demo
      ) VALUES (?, ?, 'Glossary', '', 1, 0, 'glossary', -1000, 'shared', 1, ?)
    `).run(scope.user_id, scopeNoteId, scope.is_demo ? 1 : 0);
    note = db.prepare('SELECT * FROM notes WHERE id = ?').get(ins.lastInsertRowid);
  }

  return { glossary, note };
}

/**
 * Editor: scope owner, admin, or DM of any playable campaign under the scope.
 * @param {number} userId
 * @param {number} glossaryId
 */
function isGlossaryEditor(userId, glossaryId) {
  if (isAdmin(userId)) return true;
  const g = db.prepare('SELECT * FROM glossaries WHERE id = ?').get(glossaryId);
  if (!g) return false;
  const scope = db.prepare('SELECT id, user_id, is_world FROM notes WHERE id = ?').get(g.scope_note_id);
  if (!scope) return false;
  if (scope.user_id === userId) return true;
  if (isDMOfFolder(scope.id, userId)) return true;
  if (scope.is_world) {
    const campaigns = db.prepare(`
      SELECT id FROM notes
      WHERE parent_id = ? AND deleted_at IS NULL AND is_folder = 1
    `).all(scope.id);
    for (const c of campaigns) {
      if (isPlayableCampaignRoot(c.id) && isDMOfFolder(c.id, userId)) return true;
    }
  }
  return false;
}

/**
 * Can view glossary if they can see the scope note (owner/shared/grant/dm/admin).
 * Caller should use canSee from notes routes or pass a checker.
 */
function getGlossaryById(glossaryId) {
  return db.prepare('SELECT * FROM glossaries WHERE id = ?').get(glossaryId);
}

function getGlossaryByScopeNoteId(scopeNoteId) {
  return db.prepare('SELECT * FROM glossaries WHERE scope_note_id = ?').get(scopeNoteId);
}

/**
 * Find entry by name (any status) in glossary.
 */
function findEntryByName(glossaryId, name) {
  const n = normalizeName(name);
  if (!n) return null;
  return db.prepare(`
    SELECT * FROM glossary_entries WHERE glossary_id = ? AND name = ? COLLATE NOCASE
  `).get(glossaryId, n);
}

function findAliasByName(glossaryId, alias) {
  const n = normalizeName(alias);
  if (!n) return null;
  return db.prepare(`
    SELECT * FROM glossary_entry_aliases WHERE glossary_id = ? AND alias = ? COLLATE NOCASE
  `).get(glossaryId, n);
}

/**
 * True if string is used as an entry name or alias in this glossary (any status).
 */
function termTaken(glossaryId, term, { ignoreEntryId = null, ignoreAliasId = null } = {}) {
  const n = normalizeName(term);
  if (!n) return false;
  const entry = findEntryByName(glossaryId, n);
  if (entry && entry.id !== ignoreEntryId) return true;
  const alias = findAliasByName(glossaryId, n);
  if (alias && alias.id !== ignoreAliasId) return true;
  return false;
}

/**
 * Approve or create entry; if a dismissed entry matches the name, reactivate it.
 * @returns {{ entry: object, reactivated: boolean }}
 */
function upsertApprovedEntry(glossaryId, { name, type, description, campaign_id = null }) {
  const n = normalizeName(name);
  if (!n) throw Object.assign(new Error('name required'), { status: 400 });
  if (!isValidType(type)) throw Object.assign(new Error('invalid type'), { status: 400 });
  const desc = String(description || '').trim();

  const existing = findEntryByName(glossaryId, n);
  if (existing) {
    if (existing.status === 'dismissed' || existing.status === 'suggested') {
      db.prepare(`
        UPDATE glossary_entries
        SET type = ?, description = ?, status = 'approved', campaign_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(type, desc, campaign_id, existing.id);
      return { entry: db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(existing.id), reactivated: existing.status === 'dismissed' };
    }
    throw Object.assign(new Error('An entry with that name already exists'), { status: 409 });
  }

  // Name must not collide with an alias (unless dismissed alias — then we still block name==alias of another entry's approved/suggested alias)
  const aliasHit = findAliasByName(glossaryId, n);
  if (aliasHit && aliasHit.status !== 'dismissed') {
    throw Object.assign(new Error('That name is already used as an alias'), { status: 409 });
  }
  if (aliasHit && aliasHit.status === 'dismissed') {
    // Free the dismissed alias slot so the entry name can take the unique key space? 
    // UNIQUE is on alias separately from name — name and alias are different columns,
    // so "Name" as entry and "Name" as alias can both exist unless we enforce cross-check.
    // Plan: new alias must not match another entry's name; new name must not match alias.
    // Dismissed alias matching new entry name: delete or leave? Cross-check says name can't match alias.
    // Reactivate path for manual add matching dismissed *entry* is above. For dismissed *alias*
    // matching new entry name, remove the dismissed alias so the name can be used.
    db.prepare('DELETE FROM glossary_entry_aliases WHERE id = ?').run(aliasHit.id);
  }

  const r = db.prepare(`
    INSERT INTO glossary_entries (glossary_id, name, type, description, status, campaign_id)
    VALUES (?, ?, ?, ?, 'approved', ?)
  `).run(glossaryId, n, type, desc, campaign_id);
  return { entry: db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(r.lastInsertRowid), reactivated: false };
}

/**
 * Add or reactivate an alias on an entry.
 */
function upsertAlias(glossaryId, entryId, alias, status = 'approved') {
  const a = normalizeName(alias);
  if (!a) throw Object.assign(new Error('alias required'), { status: 400 });
  if (!isValidStatus(status)) throw Object.assign(new Error('invalid status'), { status: 400 });

  const entry = db.prepare('SELECT * FROM glossary_entries WHERE id = ? AND glossary_id = ?').get(entryId, glossaryId);
  if (!entry) throw Object.assign(new Error('entry not found'), { status: 404 });

  // Cannot match another entry's name
  const nameHit = findEntryByName(glossaryId, a);
  if (nameHit && nameHit.id !== entryId) {
    if (nameHit.status === 'dismissed' && status === 'approved') {
      // Allow: alias for this entry vs dismissed entry name — prefer keeping entry name uniqueness;
      // block alias that equals another entry name always.
      throw Object.assign(new Error('That alias matches another entry name'), { status: 409 });
    }
    if (nameHit.id !== entryId) {
      throw Object.assign(new Error('That alias matches an entry name'), { status: 409 });
    }
  }
  // Alias equal to this entry's own name is pointless
  if (normalizeName(entry.name).toLowerCase() === a.toLowerCase()) {
    throw Object.assign(new Error('Alias cannot match the entry name'), { status: 400 });
  }

  const existing = findAliasByName(glossaryId, a);
  if (existing) {
    if (existing.status === 'dismissed' || existing.status === 'suggested') {
      db.prepare(`
        UPDATE glossary_entry_aliases
        SET entry_id = ?, status = ?, glossary_id = ?
        WHERE id = ?
      `).run(entryId, status, glossaryId, existing.id);
      return { alias: db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(existing.id), reactivated: existing.status === 'dismissed' };
    }
    if (existing.entry_id === entryId && existing.status === status) {
      return { alias: existing, reactivated: false };
    }
    throw Object.assign(new Error('That alias already exists'), { status: 409 });
  }

  try {
    const r = db.prepare(`
      INSERT INTO glossary_entry_aliases (glossary_id, entry_id, alias, status)
      VALUES (?, ?, ?, ?)
    `).run(glossaryId, entryId, a, status);
    return { alias: db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(r.lastInsertRowid), reactivated: false };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      throw Object.assign(new Error('That alias already exists'), { status: 409 });
    }
    throw e;
  }
}

/**
 * Insert suggested entry ignoring duplicates; never overwrite dismissed/approved.
 * @returns {object|null} inserted row or null if skipped
 */
function insertSuggestedEntryIgnore(glossaryId, { name, type, description, campaign_id = null }) {
  const n = normalizeName(name);
  if (!n || !isValidType(type)) return null;
  if (findEntryByName(glossaryId, n)) return null;
  if (findAliasByName(glossaryId, n)) return null;
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO glossary_entries (glossary_id, name, type, description, status, campaign_id)
      VALUES (?, ?, ?, ?, 'suggested', ?)
    `).run(glossaryId, n, type, String(description || '').trim(), campaign_id);
    if (!r.changes) return null;
    return db.prepare('SELECT * FROM glossary_entries WHERE id = ?').get(r.lastInsertRowid);
  } catch {
    return null;
  }
}

/**
 * Insert suggested alias ignoring duplicates / dismissed blocks scans.
 */
function insertSuggestedAliasIgnore(glossaryId, entryId, alias) {
  const a = normalizeName(alias);
  if (!a) return null;
  if (findEntryByName(glossaryId, a)) return null;
  const existing = findAliasByName(glossaryId, a);
  if (existing) return null;
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO glossary_entry_aliases (glossary_id, entry_id, alias, status)
      VALUES (?, ?, ?, 'suggested')
    `).run(glossaryId, entryId, a);
    if (!r.changes) return null;
    return db.prepare('SELECT * FROM glossary_entry_aliases WHERE id = ?').get(r.lastInsertRowid);
  } catch {
    return null;
  }
}

/**
 * Terms that scans must not re-suggest (dismissed names + dismissed aliases + existing suggested/approved names/aliases).
 */
function getScanBlocklist(glossaryId) {
  const names = db.prepare('SELECT name, status FROM glossary_entries WHERE glossary_id = ?').all(glossaryId);
  const aliases = db.prepare('SELECT alias, status FROM glossary_entry_aliases WHERE glossary_id = ?').all(glossaryId);
  const blocked = new Set();
  for (const e of names) blocked.add(e.name.toLowerCase());
  for (const a of aliases) blocked.add(a.alias.toLowerCase());
  return blocked;
}

/**
 * Approved entries for recap (world-wide or matching campaign).
 */
function getApprovedEntriesForRecap(glossaryId, campaignId) {
  const entries = db.prepare(`
    SELECT * FROM glossary_entries
    WHERE glossary_id = ? AND status = 'approved'
      AND (campaign_id IS NULL OR campaign_id = ?)
    ORDER BY type ASC, name ASC
  `).all(glossaryId, campaignId);
  return entries.map((e) => {
    const aliases = db.prepare(`
      SELECT alias FROM glossary_entry_aliases
      WHERE entry_id = ? AND status = 'approved'
      ORDER BY alias ASC
    `).all(e.id).map((a) => a.alias);
    return { ...e, aliases };
  });
}

/**
 * Format glossary block lines for the recap prompt.
 */
function formatGlossaryBlock(entries) {
  if (!entries.length) return '';
  const lines = entries.map((e) => {
    const base = `${e.name} (${e.type}): ${e.description || ''}`.trim();
    if (e.aliases?.length) return `${base} Also written as: ${e.aliases.join(', ')}`;
    return base;
  });
  return `<glossary>\n${lines.join('\n')}\n</glossary>`;
}

/**
 * PC titles to skip in scans (notes with played_by set under scope subtree).
 */
function getPlayedByTitles(scopeNoteId) {
  // Subtree: all notes under scope
  const titles = [];
  const queue = [scopeNoteId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const kids = db.prepare(`
      SELECT id, title, played_by, is_folder, deleted_at FROM notes WHERE parent_id = ? AND deleted_at IS NULL
    `).all(id);
    for (const k of kids) {
      if (k.played_by) titles.push(k.title);
      if (k.is_folder) queue.push(k.id);
    }
  }
  return titles;
}

/**
 * Delete glossary and its stub note (entries/aliases cascade).
 */
function deleteGlossaryAndStub(glossaryId) {
  const g = db.prepare('SELECT * FROM glossaries WHERE id = ?').get(glossaryId);
  if (!g) return;
  db.prepare(`
    DELETE FROM notes WHERE parent_id = ? AND COALESCE(is_glossary, 0) = 1
  `).run(g.scope_note_id);
  db.prepare('DELETE FROM glossaries WHERE id = ?').run(glossaryId);
}

module.exports = {
  ENTRY_TYPES,
  STATUSES,
  normalizeName,
  isValidType,
  isValidStatus,
  isGlossaryScopeRoot,
  listGlossaryScopeRoots,
  getTopLevelScopeForNote,
  getGlossaryForSession,
  ensureGlossaryForScope,
  isGlossaryEditor,
  getGlossaryById,
  getGlossaryByScopeNoteId,
  findEntryByName,
  findAliasByName,
  termTaken,
  upsertApprovedEntry,
  upsertAlias,
  insertSuggestedEntryIgnore,
  insertSuggestedAliasIgnore,
  getScanBlocklist,
  getApprovedEntriesForRecap,
  formatGlossaryBlock,
  getPlayedByTitles,
  deleteGlossaryAndStub,
};
