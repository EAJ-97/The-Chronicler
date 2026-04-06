/**
 * Builds visibility-safe text corpora for AI tools (Lore So Far, Continuity, etc.).
 * Mirrors note list rules for DM-only notes and uses canSee-style grants.
 */

const db = require('../db/database');
const { getRootFolderId, isGrantedUser } = require('./access');

const MAX_NOTE_CHARS = 6000;
const MAX_REF_DEPTH = 4;

/**
 * Returns all note ids in a subtree (including root), non-deleted.
 * @param {number} rootId
 * @returns {number[]}
 */
function getSubtreeNoteIds(rootId) {
  const ids = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    ids.push(id);
    const children = db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(id);
    children.forEach((c) => queue.push(c.id));
  }
  return ids;
}

/**
 * Whether a note may be included in a user's AI corpus (list visibility + DM-only rules).
 * @param {number} noteId
 * @param {number} userId
 * @param {boolean} isAdmin
 * @returns {boolean}
 */
function canIncludeNoteInCorpus(noteId, userId, isAdmin) {
  if (isAdmin) return true;
  const note = db
    .prepare('SELECT user_id, visibility, is_dm_only FROM notes WHERE id = ? AND deleted_at IS NULL')
    .get(noteId);
  if (!note) return false;
  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;
  if (!isGrantedUser(noteId, userId)) return false;
  if (!note.is_dm_only) return true;
  const granted = db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(noteId, userId);
  if (granted) return true;
  const rootId = getRootFolderId(noteId);
  return !!(
    rootId &&
    db.prepare("SELECT 1 FROM folder_roles WHERE folder_id = ? AND user_id = ? AND role = 'dm'").get(rootId, userId)
  );
}

/**
 * Extracts referenced note ids from markdown: `note:123` and `[title](note:123)`.
 * @param {string} markdown
 * @returns {number[]}
 */
function extractNoteRefsFromMarkdown(markdown) {
  const text = String(markdown || '');
  const ids = new Set();
  const re1 = /\bnote:(\d+)/gi;
  let m;
  while ((m = re1.exec(text)) !== null) {
    const id = parseInt(m[1], 10);
    if (Number.isFinite(id)) ids.add(id);
  }
  const re2 = /\]\(note:(\d+)\)/gi;
  while ((m = re2.exec(text)) !== null) {
    const id = parseInt(m[1], 10);
    if (Number.isFinite(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Loads journal text for all sessions under a campaign folder, chronological order.
 * @param {number} campaignFolderId
 * @returns {string}
 */
function buildJournalCorpusText(campaignFolderId) {
  const sessions = db
    .prepare(
      `
    SELECT id, title, session_number, created_at FROM sessions
    WHERE folder_id = ?
    ORDER BY COALESCE(session_number, 999999) ASC, created_at ASC, id ASC
  `
    )
    .all(campaignFolderId);

  const parts = [];
  for (const s of sessions) {
    const entries = db
      .prepare(
        `
      SELECT je.content, je.indent_level, u.username as author, je.created_at
      FROM journal_entries je
      JOIN users u ON u.id = je.user_id
      WHERE je.session_id = ? AND je.is_session_break = 0
      ORDER BY je.sort_order ASC, je.id ASC
    `
      )
      .all(s.id);

    if (entries.length === 0) continue;
    const label = s.title || `Session ${s.session_number || s.id}`;
    parts.push(`\n### ${label} (${s.created_at || ''})\n`);
    entries.forEach((e) => {
      const indent = '  '.repeat(e.indent_level || 0);
      parts.push(`${indent}[${e.author}]: ${e.content}\n`);
    });
  }
  return parts.join('\n').trim();
}

/**
 * Builds connection lines for notes in `allowedIds` (canon vs theory/ship labeled).
 * @param {Set<number>} allowedIds
 * @returns {string[]}
 */
function buildConnectionLines(allowedIds) {
  const rows = db
    .prepare(
      `
    SELECT c.source_note_id, c.target_note_id, c.label, c.connection_kind, c.is_speculative
    FROM connections c
  `
    )
    .all();

  const lines = [];
  for (const c of rows) {
    const src = c.source_note_id;
    const tgt = c.target_note_id;
    if (!allowedIds.has(src) || !allowedIds.has(tgt)) continue;
    const kind = c.connection_kind || (c.is_speculative ? 'theory' : 'canon');
    const lbl = (c.label || '').trim();
    const edge = lbl ? `${src} --[${kind}: ${lbl}]--> ${tgt}` : `${src} --[${kind}]--> ${tgt}`;
    lines.push(edge);
  }
  return lines;
}

/**
 * Builds a full lore corpus: campaign notes, connections, journal, referenced notes (world scope).
 * @param {number} campaignFolderId - Campaign root folder id (journal folder_id)
 * @param {number} userId
 * @param {boolean} isAdmin
 * @returns {{ corpusUser: string, noteCount: number, refCount: number }}
 */
function buildLoreCorpus(campaignFolderId, userId, isAdmin) {
  const subtreeIds = getSubtreeNoteIds(campaignFolderId);
  const allowed = new Set();
  for (const nid of subtreeIds) {
    if (canIncludeNoteInCorpus(nid, userId, isAdmin)) allowed.add(nid);
  }

  const noteBlocks = [];
  for (const nid of subtreeIds) {
    if (!allowed.has(nid)) continue;
    const n = db
      .prepare(
        'SELECT id, title, category, is_folder, content, is_dm_only FROM notes WHERE id = ? AND deleted_at IS NULL'
      )
      .get(nid);
    if (!n || n.is_folder) continue;
    let body = String(n.content || '');
    if (body.length > MAX_NOTE_CHARS) body = body.slice(0, MAX_NOTE_CHARS) + '\n…[truncated]';
    noteBlocks.push(
      `## Note [${n.id}] ${n.title} (${n.category || 'general'})${n.is_dm_only ? ' [DM-only]' : ''}\n${body}\n`
    );
  }

  const connLines = buildConnectionLines(allowed);
  const journalText = buildJournalCorpusText(campaignFolderId);

  // Referenced notes outside subtree (e.g. world lore via @mention links)
  const refIds = new Set();
  for (const nid of subtreeIds) {
    if (!allowed.has(nid)) continue;
    const n = db.prepare('SELECT content FROM notes WHERE id = ?').get(nid);
    if (!n) continue;
    extractNoteRefsFromMarkdown(n.content).forEach((id) => refIds.add(id));
  }

  const refBlocks = [];
  let depth = 0;
  const queue = [...refIds];
  const seenRef = new Set();
  while (queue.length && depth < MAX_REF_DEPTH) {
    const batch = queue.splice(0, queue.length);
    depth += 1;
    for (const rid of batch) {
      if (allowed.has(rid) || seenRef.has(rid)) continue;
      seenRef.add(rid);
      if (!canIncludeNoteInCorpus(rid, userId, isAdmin)) continue;
      const n = db
        .prepare(
          'SELECT id, title, category, is_folder, content, is_dm_only FROM notes WHERE id = ? AND deleted_at IS NULL'
        )
        .get(rid);
      if (!n || n.is_folder) continue;
      let body = String(n.content || '');
      if (body.length > MAX_NOTE_CHARS) body = body.slice(0, MAX_NOTE_CHARS) + '\n…[truncated]';
      refBlocks.push(
        `## Referenced note [${n.id}] ${n.title} (${n.category || 'general'})${n.is_dm_only ? ' [DM-only]' : ''}\n${body}\n`
      );
      extractNoteRefsFromMarkdown(n.content).forEach((id) => {
        if (!seenRef.has(id) && !allowed.has(id)) queue.push(id);
      });
    }
  }

  const parts = [];
  parts.push('# Campaign notes (visible to you)\n\n');
  parts.push(noteBlocks.join('\n---\n'));
  if (connLines.length) {
    parts.push('\n\n# Connections (between included notes)\n\n');
    parts.push(connLines.join('\n'));
  }
  if (journalText) {
    parts.push('\n\n# Journal (chronological)\n\n');
    parts.push(journalText);
  }
  if (refBlocks.length) {
    parts.push('\n\n# Referenced notes (via note: links in campaign notes)\n\n');
    parts.push(refBlocks.join('\n---\n'));
  }

  const corpusUser = parts.join('\n');
  return {
    corpusUser,
    noteCount: noteBlocks.length,
    refCount: refBlocks.length,
  };
}

/**
 * Same as buildLoreCorpus but for DM continuity: include all notes in subtree that the DM can see (stricter DM path).
 * Uses same canIncludeNoteInCorpus for consistency when uid is DM.
 */
function buildContinuityCorpus(folderId, userId, isAdmin) {
  return buildLoreCorpus(folderId, userId, isAdmin);
}

/**
 * Builds markdown context for notes referenced in the prompt (`note:id`, `[t](note:id)` from @mentions).
 * Only includes notes the user may see (same rules as lore corpus).
 * @param {string} promptText
 * @param {number} userId
 * @param {boolean} isAdmin
 * @returns {string} Empty string if no refs or none visible.
 */
function buildAttachmentContextFromPrompt(promptText, userId, isAdmin) {
  const ids = extractNoteRefsFromMarkdown(promptText);
  if (ids.length === 0) return '';

  const blocks = [];
  for (const nid of ids) {
    if (!canIncludeNoteInCorpus(nid, userId, isAdmin)) continue;
    const n = db
      .prepare(
        'SELECT id, title, category, is_folder, content, is_dm_only FROM notes WHERE id = ? AND deleted_at IS NULL'
      )
      .get(nid);
    if (!n || n.is_folder) continue;
    let body = String(n.content || '');
    if (body.length > MAX_NOTE_CHARS) body = body.slice(0, MAX_NOTE_CHARS) + '\n…[truncated]';
    blocks.push(
      `## Linked note [${n.id}] ${n.title} (${n.category || 'general'})${n.is_dm_only ? ' [DM-only]' : ''}\n${body}\n`
    );
  }
  if (!blocks.length) return '';
  return '# Notes linked from your prompt (for continuity)\n\n' + blocks.join('\n---\n');
}

module.exports = {
  getSubtreeNoteIds,
  canIncludeNoteInCorpus,
  extractNoteRefsFromMarkdown,
  buildLoreCorpus,
  buildContinuityCorpus,
  buildJournalCorpusText,
  buildAttachmentContextFromPrompt,
};
