/**
 * Chronicler JSON backup: build export payloads (DM/admin) and import them (admin only).
 * Format version 1 — pretty-printed JSON for human reading; stable keys for programmatic import.
 */

const fs = require('fs');
const path = require('path');

const EXPORT_VERSION = 1;

/**
 * Returns true when the folder is a valid export root: a folder, not trashed, and either
 * a top-level root or a campaign folder whose parent is a world layer.
 * @param {import('better-sqlite3').Database} db
 * @param {number} folderId
 * @returns {boolean}
 */
function isValidExportRoot(db, folderId) {
  const row = db
    .prepare(
      `SELECT id, parent_id, is_folder, is_world, deleted_at FROM notes WHERE id = ?`
    )
    .get(folderId);
  if (!row || !row.is_folder || row.deleted_at) return false;
  if (!row.parent_id) return true;
  const parent = db.prepare(`SELECT is_world FROM notes WHERE id = ?`).get(row.parent_id);
  return !!(parent && parent.is_world === 1);
}

/**
 * Loads every non-deleted note in the subtree rooted at folderId (including the root row).
 * @param {import('better-sqlite3').Database} db
 * @param {number} folderId
 * @returns {object[]}
 */
function collectSubtreeNotes(db, folderId) {
  return db
    .prepare(
      `
    WITH RECURSIVE subtree AS (
      SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT n.* FROM notes n JOIN subtree s ON n.parent_id = s.id WHERE n.deleted_at IS NULL
    )
    SELECT * FROM subtree
  `
    )
    .all(folderId);
}

/**
 * Builds a URL/filename-safe slug from a title (ASCII alphanumerics and hyphens).
 * @param {string} title
 * @returns {string}
 */
function slugifyTitle(title) {
  const s = String(title || 'export')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return s || 'export';
}

/**
 * Classifies the exported root for metadata (world, standalone campaign, or campaign under world).
 * @param {{ parent_id: number|null, is_world: number }} rootRow
 * @param {{ is_world?: number }|undefined} parentRow
 * @returns {'world'|'standalone_campaign'|'world_campaign'}
 */
function classifyExportRoot(rootRow, parentRow) {
  if (!rootRow.parent_id) {
    return rootRow.is_world ? 'world' : 'standalone_campaign';
  }
  if (parentRow && parentRow.is_world === 1) return 'world_campaign';
  return 'standalone_campaign';
}

/**
 * Collects distinct user ids referenced across export tables so we can emit users_referenced.
 * @param {object} payload - Same shape as buildExportPayload output (partial ok for tests)
 * @returns {Set<number>}
 */
function collectUserIdsFromPayload(payload) {
  const s = new Set();
  const add = (id) => {
    if (id != null && Number.isFinite(Number(id))) s.add(Number(id));
  };
  for (const n of payload.notes || []) add(n.user_id);
  for (const r of payload.note_permissions || []) add(r.user_id);
  for (const r of payload.note_visibility || []) add(r.user_id);
  for (const r of payload.connections || []) add(r.created_by);
  for (const r of payload.folder_roles || []) add(r.user_id);
  for (const r of payload.journal_entries || []) add(r.user_id);
  for (const r of payload.recaps || []) add(r.generated_by);
  for (const r of payload.recap_usage || []) add(r.user_id);
  for (const r of payload.session_attendance || []) add(r.user_id);
  for (const r of payload.session_checklist_items || []) add(r.created_by);
  for (const r of payload.note_images || []) add(r.uploaded_by);
  return s;
}

/**
 * Topologically orders notes as BFS from root so each parent is inserted before its children.
 * @param {object[]} notes
 * @param {number} rootNoteId
 * @returns {object[]}
 */
function sortNotesForImport(notes, rootNoteId) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  if (!byId.has(rootNoteId)) {
    throw new Error(`Export root note ${rootNoteId} not found in notes[]`);
  }
  const result = [];
  const queue = [rootNoteId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) throw new Error(`Missing note id ${id}`);
    result.push(n);
    for (const child of notes) {
      if (child.parent_id === id) queue.push(child.id);
    }
  }
  if (result.length !== notes.length) {
    throw new Error('Export notes are not a single connected tree from root');
  }
  return result;
}

/**
 * Builds the full v1 export object for a folder subtree. Caller must authorize DM/admin.
 * @param {import('better-sqlite3').Database} db
 * @param {number} rootFolderId
 * @returns {object}
 */
function buildExportPayload(db, rootFolderId) {
  const noteRows = collectSubtreeNotes(db, rootFolderId);
  if (noteRows.length === 0) {
    throw new Error('No notes to export (missing or trashed root)');
  }
  const ids = noteRows.map((n) => n.id);
  const idSet = new Set(ids);
  const placeholders = ids.map(() => '?').join(',');

  const rootRow = noteRows.find((n) => n.id === rootFolderId);
  const parentRow = rootRow?.parent_id
    ? db.prepare(`SELECT is_world FROM notes WHERE id = ?`).get(rootRow.parent_id)
    : null;

  const note_tags = db
    .prepare(`SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders})`)
    .all(...ids);
  const note_permissions = db
    .prepare(`SELECT note_id, user_id FROM note_permissions WHERE note_id IN (${placeholders})`)
    .all(...ids);
  const note_visibility = db
    .prepare(`SELECT note_id, user_id, hidden FROM note_visibility WHERE note_id IN (${placeholders})`)
    .all(...ids);

  const connections = db
    .prepare(
      `SELECT id, source_note_id, target_note_id, label, is_speculative, connection_kind, created_by, created_at
       FROM connections WHERE source_note_id IN (${placeholders}) AND target_note_id IN (${placeholders})`
    )
    .all(...ids, ...ids);

  const folder_roles = db
    .prepare(
      `SELECT folder_id, user_id, role, assigned_at FROM folder_roles WHERE folder_id IN (${placeholders})`
    )
    .all(...ids);

  const sessions = db
    .prepare(
      `SELECT id, folder_id, title, session_number, is_demo, created_at FROM sessions WHERE folder_id IN (${placeholders})`
    )
    .all(...ids);

  const sessionIds = sessions.map((s) => s.id);
  let journal_entries = [];
  let recaps = [];
  let recap_usage = [];
  let session_attendance = [];
  let session_checklist_items = [];

  if (sessionIds.length > 0) {
    const sph = sessionIds.map(() => '?').join(',');
    journal_entries = db
      .prepare(
        `SELECT id, user_id, folder_id, session_id, content, indent_level, sort_order, created_at
         FROM journal_entries WHERE session_id IN (${sph}) OR (folder_id IS NOT NULL AND folder_id IN (${placeholders}))`
      )
      .all(...sessionIds, ...ids);
    recaps = db
      .prepare(
        `SELECT id, session_id, folder_id, generated_by, tone, content, is_dm_only, created_at FROM recaps
         WHERE session_id IN (${sph}) OR folder_id IN (${placeholders})`
      )
      .all(...sessionIds, ...ids);
    recap_usage = db
      .prepare(`SELECT session_id, user_id, count FROM recap_usage WHERE session_id IN (${sph})`)
      .all(...sessionIds);
    session_attendance = db
      .prepare(
        `SELECT session_id, user_id, attended FROM session_attendance WHERE session_id IN (${sph})`
      )
      .all(...sessionIds);
    session_checklist_items = db
      .prepare(
        `SELECT id, session_id, content, is_checked, sort_order, created_by, created_at
         FROM session_checklist_items WHERE session_id IN (${sph})`
      )
      .all(...sessionIds);
  } else {
    journal_entries = db
      .prepare(
        `SELECT id, user_id, folder_id, session_id, content, indent_level, sort_order, created_at
         FROM journal_entries WHERE folder_id IS NOT NULL AND folder_id IN (${placeholders})`
      )
      .all(...ids);
    recaps = db
      .prepare(
        `SELECT id, session_id, folder_id, generated_by, tone, content, is_dm_only, created_at FROM recaps
         WHERE folder_id IN (${placeholders})`
      )
      .all(...ids);
  }

  const note_images = db
    .prepare(
      `SELECT id, note_id, filename, original_name, uploaded_by, created_at FROM note_images WHERE note_id IN (${placeholders})`
    )
    .all(...ids);

  const draft = {
    chronicler_export_version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    root_note_id: rootFolderId,
    root_kind: classifyExportRoot(rootRow, parentRow),
    notes: noteRows,
    note_tags,
    note_permissions,
    note_visibility,
    connections,
    folder_roles,
    sessions,
    journal_entries,
    recaps,
    recap_usage,
    session_attendance,
    session_checklist_items,
    note_images,
  };

  const userIdSet = collectUserIdsFromPayload(draft);
  const users_referenced = [];
  for (const uid of userIdSet) {
    const u = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(uid);
    if (u) users_referenced.push({ id: u.id, username: u.username });
  }

  return { ...draft, users_referenced };
}

/**
 * Imports a v1 payload inside a transaction: remaps note/session ids and resolves users by username.
 * Image rows are copied for reference; binary files are not included in JSON and must be restored separately.
 * @param {import('better-sqlite3').Database} db
 * @param {object} data - Parsed export JSON
 * @param {{ parentId: number|null }} opts - New parent for the exported root (null = new top-level root)
 * @returns {{ newRootId: number, counts: object }}
 */
function runImport(db, data, opts) {
  const parentId = opts.parentId != null ? Number(opts.parentId) : null;
  if (parentId != null && (!Number.isFinite(parentId) || parentId <= 0)) {
    throw new Error('Invalid parent_id');
  }
  if (data.chronicler_export_version !== EXPORT_VERSION) {
    throw new Error(`Unsupported chronicler_export_version (expected ${EXPORT_VERSION})`);
  }
  const rootNoteId = Number(data.root_note_id);
  const notes = data.notes;
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error('Invalid export: notes[] required');
  }
  if (!Number.isFinite(rootNoteId)) {
    throw new Error('Invalid export: root_note_id');
  }

  if (parentId != null) {
    const p = db
      .prepare(`SELECT id, is_folder, deleted_at FROM notes WHERE id = ?`)
      .get(parentId);
    if (!p || !p.is_folder || p.deleted_at) {
      throw new Error('parent_id must be an existing non-trashed folder');
    }
  }

  const usersRef = Array.isArray(data.users_referenced) ? data.users_referenced : [];
  const userIdMap = new Map();
  for (const u of usersRef) {
    if (u == null || u.username == null) continue;
    const row = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`).get(u.username);
    if (!row) throw new Error(`Unknown user "${u.username}" — create the account or fix users_referenced`);
    userIdMap.set(Number(u.id), row.id);
  }

  const neededIds = collectUserIdsFromPayload({
    notes,
    note_permissions: data.note_permissions || [],
    note_visibility: data.note_visibility || [],
    connections: data.connections || [],
    folder_roles: data.folder_roles || [],
    journal_entries: data.journal_entries || [],
    recaps: data.recaps || [],
    recap_usage: data.recap_usage || [],
    session_attendance: data.session_attendance || [],
    session_checklist_items: data.session_checklist_items || [],
    note_images: data.note_images || [],
  });
  for (const uid of neededIds) {
    if (!userIdMap.has(uid)) {
      throw new Error(`User id ${uid} is used in the export but missing from users_referenced`);
    }
  }

  const ordered = sortNotesForImport(notes, rootNoteId);
  const idMap = new Map();

  const insertNote = db.prepare(`
    INSERT INTO notes (
      user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order,
      visibility, significance, narrative_weight, deleted_at, original_parent_id, recovered,
      is_dm_only, is_demo, status, is_world, source_note_id, display_icon, display_summary,
      created_at, updated_at
    ) VALUES (
      @user_id, @parent_id, @title, @content, @is_shared, @is_folder, @category, @color, @sort_order,
      @visibility, @significance, @narrative_weight, @deleted_at, @original_parent_id, @recovered,
      @is_dm_only, @is_demo, @status, @is_world, @source_note_id, @display_icon, @display_summary,
      @created_at, @updated_at
    )
  `);

  const mapOptionalFk = (oldId) => {
    if (oldId == null) return null;
    return idMap.has(oldId) ? idMap.get(oldId) : null;
  };

  const run = () => {
    for (const n of ordered) {
      const oldId = n.id;
      let newParentId;
      if (oldId === rootNoteId) {
        newParentId = parentId;
      } else {
        if (n.parent_id == null || !idMap.has(n.parent_id)) {
          throw new Error(`Invalid parent reference for note "${n.title}" (id ${oldId})`);
        }
        newParentId = idMap.get(n.parent_id);
      }

      const newUserId = userIdMap.get(n.user_id);
      if (newUserId == null) throw new Error(`Missing user mapping for note owner (id ${n.user_id})`);

      const origParent = mapOptionalFk(n.original_parent_id);

      const info = insertNote.run({
        user_id: newUserId,
        parent_id: newParentId,
        title: n.title,
        content: n.content ?? '',
        is_shared: n.is_shared ?? 0,
        is_folder: n.is_folder ?? 0,
        category: n.category ?? 'general',
        color: n.color ?? '',
        sort_order: n.sort_order ?? 0,
        visibility: n.visibility ?? 'private',
        significance: n.significance ?? 'standard',
        narrative_weight: n.narrative_weight ?? 'node',
        deleted_at: n.deleted_at ?? null,
        original_parent_id: origParent,
        recovered: n.recovered ?? 0,
        is_dm_only: n.is_dm_only ?? 0,
        is_demo: n.is_demo ?? 0,
        status: n.status ?? null,
        is_world: n.is_world ?? 0,
        source_note_id: null,
        display_icon: n.display_icon ?? null,
        display_summary: n.display_summary ?? null,
        created_at: n.created_at,
        updated_at: n.updated_at,
      });

      idMap.set(oldId, Number(info.lastInsertRowid));
    }

    for (const n of notes) {
      const oldSrc = n.source_note_id;
      if (oldSrc == null) continue;
      const newId = idMap.get(n.id);
      const newSrc = idMap.has(oldSrc) ? idMap.get(oldSrc) : null;
      if (newSrc != null) {
        db.prepare(`UPDATE notes SET source_note_id = ? WHERE id = ?`).run(newSrc, newId);
      }
    }

    const insTag = db.prepare(`INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)`);
    for (const r of data.note_tags || []) {
      const nid = idMap.get(r.note_id);
      if (nid) insTag.run(nid, r.tag);
    }

    const insPerm = db.prepare(`INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)`);
    for (const r of data.note_permissions || []) {
      const nid = idMap.get(r.note_id);
      const uid = userIdMap.get(r.user_id);
      if (nid && uid) insPerm.run(nid, uid);
    }

    const insVis = db.prepare(
      `INSERT OR IGNORE INTO note_visibility (note_id, user_id, hidden) VALUES (?, ?, ?)`
    );
    for (const r of data.note_visibility || []) {
      const nid = idMap.get(r.note_id);
      const uid = userIdMap.get(r.user_id);
      if (nid && uid) insVis.run(nid, uid, r.hidden ?? 0);
    }

    const insConn = db.prepare(
      `INSERT INTO connections (source_note_id, target_note_id, label, is_speculative, connection_kind, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of data.connections || []) {
      const s = idMap.get(c.source_note_id);
      const t = idMap.get(c.target_note_id);
      const by = userIdMap.get(c.created_by);
      if (s && t && by) {
        try {
          const kind = c.connection_kind === 'theory' || c.connection_kind === 'ship' ? c.connection_kind : 'canon';
          insConn.run(s, t, c.label ?? '', c.is_speculative ?? 0, kind, by, c.created_at);
        } catch (e) {
          if (!String(e.message).includes('UNIQUE')) throw e;
        }
      }
    }

    const insRole = db.prepare(
      `INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role, assigned_at) VALUES (?, ?, ?, ?)`
    );
    for (const r of data.folder_roles || []) {
      const fid = idMap.get(r.folder_id);
      const uid = userIdMap.get(r.user_id);
      if (fid && uid) insRole.run(fid, uid, r.role || 'dm', r.assigned_at);
    }

    const sessionIdMap = new Map();
    const insSession = db.prepare(
      `INSERT INTO sessions (folder_id, title, session_number, is_demo, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    for (const s of data.sessions || []) {
      const fid = idMap.get(s.folder_id);
      if (!fid) throw new Error(`Session references missing folder ${s.folder_id}`);
      const r = insSession.run(
        fid,
        s.title ?? null,
        s.session_number ?? null,
        s.is_demo ?? 0,
        s.created_at
      );
      sessionIdMap.set(s.id, Number(r.lastInsertRowid));
    }

    const insEntry = db.prepare(
      `INSERT INTO journal_entries (user_id, folder_id, session_id, content, indent_level, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of data.journal_entries || []) {
      const uid = userIdMap.get(e.user_id);
      const fid = e.folder_id != null ? idMap.get(e.folder_id) : null;
      const sid = e.session_id != null ? sessionIdMap.get(e.session_id) : null;
      if (!uid) continue;
      if (e.folder_id != null && fid == null) continue;
      if (e.session_id != null && sid == null) continue;
      insEntry.run(uid, fid, sid, e.content ?? '', e.indent_level ?? 0, e.sort_order ?? 0, e.created_at);
    }

    const insRecap = db.prepare(
      `INSERT INTO recaps (session_id, folder_id, generated_by, tone, content, is_dm_only, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of data.recaps || []) {
      const sid = sessionIdMap.get(r.session_id);
      const fid = idMap.get(r.folder_id);
      const gen = userIdMap.get(r.generated_by);
      if (sid && fid && gen) {
        insRecap.run(sid, fid, gen, r.tone || 'chronicle', r.content ?? '', r.is_dm_only ?? 0, r.created_at);
      }
    }

    const insRU = db.prepare(
      `INSERT OR REPLACE INTO recap_usage (session_id, user_id, count) VALUES (?, ?, ?)`
    );
    for (const r of data.recap_usage || []) {
      const sid = sessionIdMap.get(r.session_id);
      const uid = userIdMap.get(r.user_id);
      if (sid && uid) insRU.run(sid, uid, r.count ?? 0);
    }

    const insAtt = db.prepare(
      `INSERT OR REPLACE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, ?)`
    );
    for (const r of data.session_attendance || []) {
      const sid = sessionIdMap.get(r.session_id);
      const uid = userIdMap.get(r.user_id);
      if (sid && uid) insAtt.run(sid, uid, r.attended ?? 1);
    }

    const insChk = db.prepare(
      `INSERT INTO session_checklist_items (session_id, content, is_checked, sort_order, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of data.session_checklist_items || []) {
      const sid = sessionIdMap.get(r.session_id);
      const uid = userIdMap.get(r.created_by);
      if (sid && uid) {
        insChk.run(sid, r.content ?? '', r.is_checked ?? 0, r.sort_order ?? 0, uid, r.created_at);
      }
    }

    const insImg = db.prepare(
      `INSERT INTO note_images (note_id, filename, original_name, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    for (const im of data.note_images || []) {
      const nid = idMap.get(im.note_id);
      const uid = userIdMap.get(im.uploaded_by);
      if (nid && uid) {
        insImg.run(nid, im.filename, im.original_name ?? im.filename, uid, im.created_at);
      }
    }

    const newRootId = idMap.get(rootNoteId);
    if (!newRootId) throw new Error('Import failed: root id not mapped');

    return {
      newRootId,
      counts: {
        notes: notes.length,
        connections: (data.connections || []).length,
        sessions: (data.sessions || []).length,
        journal_entries: (data.journal_entries || []).length,
        recaps: (data.recaps || []).length,
      },
    };
  };

  return db.transaction(run)();
}

/**
 * Escapes text for safe use in HTML document title and quoted attributes.
 * @param {string} s
 * @returns {string}
 */
function escapeHtmlTitle(s) {
  return String(s || 'Chronicler export')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds a single .html file embedding the export as base64 UTF-8 JSON. The DM can open it locally
 * in a browser (read-only); markdown rendering uses CDN scripts when online.
 * @param {object} payload - Same shape as buildExportPayload output
 * @returns {string} Full HTML document
 */
function buildStandaloneViewerHtml(payload) {
  const tplPath = path.join(__dirname, '../templates/chronicler-export-viewer-embedded.html');
  let tpl = fs.readFileSync(tplPath, 'utf8');
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const rootTitle =
    (payload.notes || []).find((n) => n.id === payload.root_note_id)?.title || 'Chronicler export';
  tpl = tpl.replace(/__BASE64_PAYLOAD__/g, b64);
  tpl = tpl.replace(/__HTML_ESCAPED_TITLE__/g, escapeHtmlTitle(rootTitle));
  return tpl;
}

module.exports = {
  EXPORT_VERSION,
  isValidExportRoot,
  buildExportPayload,
  buildStandaloneViewerHtml,
  slugifyTitle,
  runImport,
  collectUserIdsFromPayload,
  sortNotesForImport,
};
