const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin, getRootFolderId, getCampaignFolderId, isDMOf, isDMOfFolder, isGrantedUser } = require('../utils/access');

const router = express.Router();

// Helper: can this user see this note?
function canSee(noteId, userId, isAdminUser) {
  if (isAdminUser) return true;
  const note = db.prepare('SELECT user_id, visibility FROM notes WHERE id = ?').get(noteId);
  if (!note) return false;
  if (note.user_id === userId) return true;
  if (note.visibility === 'shared') return true;
  // Check note_permissions on this note OR any ancestor folder
  return isGrantedUser(noteId, userId);
}

// Helper: attach tags to note
function withTags(note) {
  if (!note) return note;
  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(note.id).map(r => r.tag);
  return { ...note, tags };
}

// Helper: attach granted user ids to note
function withPermissions(note) {
  if (!note) return note;
  const granted = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(note.id).map(r => r.user_id);
  return { ...note, granted_users: granted };
}

// GET all notes visible to user
router.get('/', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const { tag } = req.query;
  // Admin-only: role simulation and/or full visibility as another user (mutually exclusive)
  let simulate = admin ? req.query.simulate : null;
  const rawAsUser = req.query.as_user != null && String(req.query.as_user).trim() !== ''
    ? parseInt(String(req.query.as_user), 10)
    : NaN;
  const asUserId = admin && Number.isFinite(rawAsUser) ? rawAsUser : null;
  if (asUserId != null && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(asUserId)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const listingUserId = asUserId != null ? asUserId : req.user.id;
  if (asUserId != null) simulate = null;
  const listingAdminAll = admin && !simulate && asUserId == null;

  // Columns returned in list — content excluded for performance (fetched on demand via GET /:id)
  const LIST_COLS = `n.id, n.user_id, n.parent_id, n.title, n.is_shared, n.is_folder,
    n.category, n.color, n.sort_order, n.visibility, n.created_at, n.updated_at,
    n.significance, n.narrative_weight, n.deleted_at, n.original_parent_id,
    n.recovered, n.is_dm_only, n.is_demo, n.is_world, n.source_note_id, u.username AS author`;

  let notes;
  if (listingAdminAll) {
    notes = db.prepare(`
      SELECT ${LIST_COLS} FROM notes n
      JOIN users u ON n.user_id = u.id
      WHERE n.deleted_at IS NULL
      ORDER BY n.is_folder DESC, n.sort_order ASC, n.title ASC
    `).all();
  } else {
    // Non-admin path — also used when admin is simulating a role
    if (simulate === 'hidden') {
      // Hidden: only shared notes
      notes = db.prepare(`
        SELECT ${LIST_COLS} FROM notes n
        JOIN users u ON n.user_id = u.id
        WHERE n.deleted_at IS NULL AND n.visibility = 'shared'
        ORDER BY n.is_folder DESC, n.sort_order ASC, n.title ASC
      `).all();
    } else if (simulate === 'granted') {
      // Granted: shared + explicitly granted (no own-private, no DM)
      notes = db.prepare(`
        SELECT ${LIST_COLS} FROM notes n
        JOIN users u ON n.user_id = u.id
        WHERE n.deleted_at IS NULL
          AND (n.visibility = 'shared'
            OR EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = n.id AND np.user_id = ?))
        ORDER BY n.is_folder DESC, n.sort_order ASC, n.title ASC
      `).all(listingUserId);
    } else {
      // owner / dm / real non-admin: own + shared + granted
      notes = db.prepare(`
        SELECT ${LIST_COLS} FROM notes n
        JOIN users u ON n.user_id = u.id
        WHERE n.deleted_at IS NULL
          AND (n.user_id = ?
            OR n.visibility = 'shared'
            OR EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = n.id AND np.user_id = ?))
        ORDER BY n.is_folder DESC, n.sort_order ASC, n.title ASC
      `).all(listingUserId, listingUserId);
    }

    // Private folder cascade: visibility is determined by location, not ownership.
    // A note inside a private folder the user can't access is hidden —
    // even if the user owns that note.
    const notesById = new Map(notes.map(n => [n.id, n]));
    const canAccessAncestors = (note) => {
      let parentId = note.parent_id;
      while (parentId != null) {
        const parent = notesById.get(parentId);
        if (!parent) break;
        if (parent.is_folder && parent.visibility === 'hidden' && parent.user_id !== listingUserId) {
          const granted = db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(parent.id, listingUserId);
          if (!granted) return false;
        }
        parentId = parent.parent_id;
      }
      return true;
    };

    notes = notes.filter(n => canAccessAncestors(n));

    // DM visibility: include ALL notes from campaigns where user is DM
    // When simulating DM, treat all root campaigns as DM campaigns
    const dmCampaigns = (simulate === 'dm')
      ? db.prepare('SELECT id AS folder_id FROM notes WHERE parent_id IS NULL AND is_folder = 1 AND deleted_at IS NULL').all()
      : (!simulate)
        ? db.prepare("SELECT folder_id FROM folder_roles WHERE user_id = ? AND role = 'dm'").all(listingUserId)
        : []; // owner/granted/default — no DM boost
    if (dmCampaigns.length > 0) {
      const dmNoteIds = new Set();
      const q2 = dmCampaigns.map(r => r.folder_id);
      while (q2.length) {
        const pid = q2.shift();
        if (dmNoteIds.has(pid)) continue;
        dmNoteIds.add(pid);
        db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(pid)
          .forEach(c => q2.push(c.id));
      }
      const currentIds = new Set(notes.map(n => n.id));
      const missing = [...dmNoteIds].filter(id => !currentIds.has(id));
      if (missing.length > 0) {
        const ph = missing.map(() => '?').join(',');
        const extra = db.prepare(`SELECT ${LIST_COLS} FROM notes n JOIN users u ON n.user_id = u.id WHERE n.id IN (${ph}) AND n.deleted_at IS NULL`).all(...missing);
        notes = [...notes, ...extra];
      }
    }

    // Surface ancestor folders for visible notes whose parent folders weren't
    // returned by the main query — prevents notes appearing detached in the tree.
    const visibleIds = new Set(notes.map(n => n.id));
    const ancestorsToAdd = new Map();
    notes.forEach(n => {
      let parentId = n.parent_id;
      while (parentId && !visibleIds.has(parentId) && !ancestorsToAdd.has(parentId)) {
        const ancestor = db.prepare(`SELECT ${LIST_COLS} FROM notes n JOIN users u ON n.user_id = u.id WHERE n.id = ?`).get(parentId);
        if (!ancestor) break;
        ancestorsToAdd.set(ancestor.id, ancestor);
        visibleIds.add(ancestor.id);
        parentId = ancestor.parent_id;
      }
    });
    if (ancestorsToAdd.size > 0) notes = [...notes, ...ancestorsToAdd.values()];

    // ─── World-layer note inheritance (3-tier model) ───
    // For each campaign a user is a member of, if it's under a world layer,
    // include the world layer's direct-child notes that the user can see.
    if (!listingAdminAll && simulate !== 'dm') {
      // Find campaigns this user is a member of
      const userMembershipCampaigns = new Set();
      const visibleIds = new Set(notes.map(n => n.id));

      // Check which campaigns/folders the user is a member of via note_permissions
      const userGrantedFolders = db.prepare('SELECT DISTINCT parent.id FROM notes parent WHERE EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = parent.id AND np.user_id = ?) AND parent.is_folder = 1').all(listingUserId);
      userGrantedFolders.forEach(f => userMembershipCampaigns.add(f.id));

      // For each campaign, check if it has a world layer parent
      const worldLayerNotes = [];
      const seenOverrideSourceIds = new Set();

      for (const campaignId of userMembershipCampaigns) {
        const campaign = db.prepare('SELECT parent_id, is_world FROM notes WHERE id = ?').get(campaignId);
        if (campaign && campaign.parent_id && campaign.is_world === 0) {
          // Campaign is under a world layer
          const worldId = campaign.parent_id;
          const worldRoot = db.prepare('SELECT is_world FROM notes WHERE id = ?').get(worldId);
          
          if (worldRoot && worldRoot.is_world === 1) {
            // Fetch all direct children of the world that pass canSee
            const worldChildren = db.prepare(`
              SELECT ${LIST_COLS} FROM notes n
              JOIN users u ON n.user_id = u.id
              WHERE n.parent_id = ? AND n.deleted_at IS NULL
            `).all(worldId);

            for (const wn of worldChildren) {
              if (canSee(wn.id, listingUserId, false)) {
                // Tag it with world_layer_id so frontend knows it's inherited
                wn.world_layer_id = worldId;
                wn.world_layer_campaign_id = campaignId;
                
                // Check if campaign has an override for this world note
                const override = db.prepare(`
                  SELECT n.id FROM notes n
                  WHERE n.source_note_id = ? 
                    AND n.parent_id IN (
                      SELECT id FROM notes WHERE id = ? OR parent_id = ?
                    )
                  LIMIT 1
                `).get(wn.id, campaignId, campaignId);
                
                if (!override) {
                  // No override, include the world note
                  if (!visibleIds.has(wn.id)) {
                    worldLayerNotes.push(wn);
                    visibleIds.add(wn.id);
                  }
                } else {
                  // Override exists; don't include the world note
                  // (the override should already be in the notes list)
                  seenOverrideSourceIds.add(wn.id);
                }
              }
            }
          }
        }
      }

      // Add world-layer notes to results
      if (worldLayerNotes.length > 0) {
        notes = [...notes, ...worldLayerNotes];
      }
    }
  }

  if (tag) {
    const taggedIds = new Set(db.prepare('SELECT note_id FROM note_tags WHERE tag = ?').all(tag).map(r => r.note_id));
    notes = notes.filter(n => taggedIds.has(n.id));
  }

  // Strip DM-only notes for users who aren't admin, DM, or explicitly granted on that note
  if (!listingAdminAll && simulate !== 'dm') {
    const userDmFolderIds = new Set(
      db.prepare("SELECT folder_id FROM folder_roles WHERE user_id = ? AND role = 'dm'").all(listingUserId).map(r => r.folder_id)
    );
    const userGrantedNoteIds = new Set(
      db.prepare("SELECT note_id FROM note_permissions WHERE user_id = ?").all(listingUserId).map(r => r.note_id)
    );
    notes = notes.filter(n => {
      if (!n.is_dm_only) return true;
      if (userGrantedNoteIds.has(n.id)) return true;
      const rootId = getRootFolderId(n.id);
      return rootId && userDmFolderIds.has(rootId);
    });
  }

  // Bulk-load all tags and grants in 2 queries instead of N
  const noteIds = notes.map(n => n.id);
  if (noteIds.length === 0) return res.json([]);

  const placeholders = noteIds.map(() => '?').join(',');
  const allTagRows = db.prepare(`SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders})`).all(...noteIds);
  const allGrantRows = db.prepare(`SELECT note_id, user_id FROM note_permissions WHERE note_id IN (${placeholders})`).all(...noteIds);

  const tagsByNote = {};
  allTagRows.forEach(r => { (tagsByNote[r.note_id] = tagsByNote[r.note_id] || []).push(r.tag); });
  const grantsByNote = {};
  allGrantRows.forEach(r => { (grantsByNote[r.note_id] = grantsByNote[r.note_id] || []).push(r.user_id); });

  res.json(notes.map(n => ({ ...n, tags: tagsByNote[n.id] || [], granted_users: grantsByNote[n.id] || [] })));
});

// GET campaign folder IDs where current user is a DM (admin may pass as_user to inspect another account)
router.get('/meta/my-dm-campaigns', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const raw = req.query.as_user != null && String(req.query.as_user).trim() !== ''
    ? parseInt(String(req.query.as_user), 10)
    : NaN;
  const asUserId = admin && Number.isFinite(raw) ? raw : null;
  if (asUserId != null && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(asUserId)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const uid = asUserId != null ? asUserId : req.user.id;
  const rows = db.prepare("SELECT folder_id FROM folder_roles WHERE user_id = ? AND role = 'dm'").all(uid);
  res.json(rows.map(r => r.folder_id));
});

// GET world layer folders where current user is a DM (for campaign creation picker)
router.get('/meta/worlds', authenticateToken, (req, res) => {
  const worlds = db.prepare(`
    SELECT id, title, user_id FROM notes
    WHERE is_world = 1 AND parent_id IS NULL AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM folder_roles WHERE folder_id = notes.id AND user_id = ? AND role = 'dm')
    ORDER BY title ASC
  `).all(req.user.id);
  res.json(worlds);
});

// GET all tags (must be before /:id)
router.get('/meta/tags', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const tags = admin
    ? db.prepare('SELECT DISTINCT tag, COUNT(*) as count FROM note_tags GROUP BY tag ORDER BY count DESC').all()
    : db.prepare(`
        SELECT DISTINCT nt.tag, COUNT(*) as count FROM note_tags nt
        JOIN notes n ON nt.note_id = n.id
        WHERE n.user_id = ? OR n.visibility = 'shared'
          OR EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = n.id AND np.user_id = ?)
        GROUP BY nt.tag ORDER BY count DESC
      `).all(req.user.id, req.user.id);
  res.json(tags);
});

// GET all users (for permission grants — available to all logged-in users)
router.get('/meta/users', authenticateToken, (req, res) => {
  const { campaign_id } = req.query;
  let users;
  if (campaign_id) {
    // Return only members of this campaign with is_dm flag
    users = db.prepare(`
      SELECT DISTINCT u.id, u.username, u.is_admin,
        CASE WHEN EXISTS (SELECT 1 FROM folder_roles fr WHERE fr.folder_id = ? AND fr.user_id = u.id) THEN 1 ELSE 0 END as is_dm
      FROM users u
      WHERE u.id != ?
        AND (
          EXISTS (SELECT 1 FROM note_permissions np WHERE np.note_id = ? AND np.user_id = u.id)
          OR EXISTS (SELECT 1 FROM folder_roles fr WHERE fr.folder_id = ? AND fr.user_id = u.id)
        )
      ORDER BY u.username ASC
    `).all(campaign_id, req.user.id, campaign_id, campaign_id);
  } else {
    users = db.prepare('SELECT id, username, is_admin, 0 as is_dm FROM users ORDER BY username ASC').all();
    users = users.filter(u => u.id !== req.user.id);
  }
  res.json(users);
});

// GET full-text search (must be before /:id)
router.get('/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  const admin = isAdmin(req.user.id);

  const tagQuery = q.trim().replace(/^#/, '').toLowerCase();
  let tagMatches = db.prepare(`
    SELECT DISTINCT n.*, u.username AS author, '' AS snippet FROM note_tags nt
    JOIN notes n ON nt.note_id = n.id JOIN users u ON n.user_id = u.id
    WHERE nt.tag LIKE ?
  `).all(`${tagQuery}%`);

  const safeQ = q.trim().replace(/['"*]/g, '') + '*';
  let ftsResults = [];
  try {
    ftsResults = db.prepare(`
      SELECT n.*, u.username AS author,
        snippet(notes_fts, 1, '<mark>', '</mark>', '...', 20) AS snippet
      FROM notes_fts JOIN notes n ON notes_fts.rowid = n.id JOIN users u ON n.user_id = u.id
      WHERE notes_fts MATCH ? ORDER BY rank LIMIT 30
    `).all(safeQ);
  } catch (e) {
    ftsResults = db.prepare(`
      SELECT n.*, u.username AS author, '' AS snippet FROM notes n JOIN users u ON n.user_id = u.id
      WHERE n.title LIKE ? OR n.content LIKE ? LIMIT 30
    `).all(`%${q}%`, `%${q}%`);
  }

  const seen = new Set();
  const results = [...tagMatches, ...ftsResults].filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return canSee(n.id, req.user.id, admin);
  });

  res.json(results.map(withTags));
});

// GET single note
// GET trash — must be before /:id to avoid route collision
router.get('/trash', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const trashed = admin
    ? db.prepare(`SELECT n.*, u.username AS author FROM notes n JOIN users u ON n.user_id = u.id WHERE n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC`).all()
    : db.prepare(`SELECT n.*, u.username AS author FROM notes n JOIN users u ON n.user_id = u.id WHERE n.deleted_at IS NOT NULL AND n.user_id = ? ORDER BY n.deleted_at DESC`).all(req.user.id);
  res.json(trashed);
});

router.get('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const note = db.prepare('SELECT n.*, u.username AS author FROM notes n JOIN users u ON n.user_id = u.id WHERE n.id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (!canSee(note.id, req.user.id, admin)) return res.status(403).json({ error: 'Access denied' });
  res.json(withPermissions(withTags(note)));
});

// GET permissions for a note (owner, DM, or admin)
router.get('/:id/permissions', authenticateToken, (req, res) => {
  const note = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const admin = isAdmin(req.user.id);
  const isOwner = note.user_id === req.user.id;
  const isDM = isDMOf(parseInt(req.params.id), req.user.id);
  if (!admin && !isOwner && !isDM) return res.status(403).json({ error: 'Owner, DM, or admin only' });
  const granted = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(req.params.id).map(r => r.user_id);
  res.json({ granted_users: granted });
});

// POST create note or folder
router.post('/', authenticateToken, (req, res) => {
  const {
    title, content = '', is_shared = false,
    is_folder = false, category = 'general',
    color = '', parent_id = null, sort_order = 0, tags = [],
    members = [],
    is_world = false, source_note_id = null
  } = req.body;

  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  // Handle override creation: source_note_id set
  if (source_note_id) {
    // Creating an override of a world-layer note
    const sourceNote = db.prepare('SELECT id, title, content, parent_id FROM notes WHERE id = ?').get(source_note_id);
    if (!sourceNote) return res.status(404).json({ error: 'Source note not found' });
    
    // Validate that source note is a world-layer note
    const sourceRoot = getRootFolderId(source_note_id);
    const sourceRootData = db.prepare('SELECT is_world FROM notes WHERE id = ?').get(sourceRoot);
    if (!sourceRootData || sourceRootData.is_world === 0) {
      return res.status(400).json({ error: 'Source note must be from a world layer' });
    }
    
    // Validate that requester is DM of the campaign this override will be under
    if (!parent_id) return res.status(400).json({ error: 'Override must specify parent_id (campaign)' });
    const campaign = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(parent_id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!isDMOf(parent_id, req.user.id)) {
      return res.status(403).json({ error: 'Must be DM of campaign to create an override' });
    }
    
    // Create override note using source as template
    const visibility = 'hidden'; // Inherited from campaign
    const result = db.prepare(`
      INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order, visibility, source_note_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, parent_id, sourceNote.title, sourceNote.content, is_shared ? 1 : 0, 0, category, color, sort_order, visibility, source_note_id);
    
    const noteId = result.lastInsertRowid;
    saveTags(noteId, tags);
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    res.status(201).json(withPermissions(withTags(note)));
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return;
  }

  // Determine visibility: inherit from parent if exists
  let visibility = 'hidden';
  let inheritedGrants = [];
  if (parent_id) {
    const parent = db.prepare('SELECT id, user_id, visibility FROM notes WHERE id = ?').get(parent_id);
    if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
    visibility = parent.visibility;
    // Inherit parent's permission grants
    inheritedGrants = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(parent_id).map(r => r.user_id);
  }

  const result = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, color, sort_order, visibility, is_world)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, parent_id, title.trim(), content, is_shared ? 1 : 0, is_folder ? 1 : 0, category, color, sort_order, visibility, is_world ? 1 : 0);

  const noteId = result.lastInsertRowid;
  saveTags(noteId, tags);

  // Copy parent's grants to new item
  const grantInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
  const grantAll = db.transaction((grants) => grants.forEach(uid => grantInsert.run(noteId, uid)));
  grantAll(inheritedGrants);

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);

  // Auto-assign creator as DM if this is a new folder (world layer or campaign)
  if (is_folder && !parent_id) {
    // Root folder: world layer
    if (members && members.length > 0) {
      const dmInsert     = db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')");
      const memberInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
      const insertMembers = db.transaction(() => {
        members.forEach(m => {
          memberInsert.run(noteId, m.user_id);
          if (m.is_dm) dmInsert.run(noteId, m.user_id);
        });
      });
      insertMembers();
      const hasDM = members.some(m => m.is_dm);
      if (!hasDM) {
        db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId, req.user.id);
      }
    } else {
      db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId, req.user.id);
    }
  } else if (is_folder && parent_id) {
    // Campaign under world layer
    if (members && members.length > 0) {
      const dmInsert     = db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')");
      const memberInsert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
      const insertMembers = db.transaction(() => {
        members.forEach(m => {
          memberInsert.run(noteId, m.user_id);
          if (m.is_dm) dmInsert.run(noteId, m.user_id);
        });
      });
      insertMembers();
      const hasDM = members.some(m => m.is_dm);
      if (!hasDM) {
        db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId, req.user.id);
      }
    } else {
      db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId, req.user.id);
    }
  }

  res.status(201).json(withPermissions(withTags(note)));
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

// PUT update note (title/content/category/tags/visibility/permissions/move)
router.put('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const isOwner   = note.user_id === req.user.id;
  const isGranted = !isOwner && isGrantedUser(note.id, req.user.id);
  const isDM      = !isOwner && isDMOf(note.id, req.user.id);

  // Permission tiers
  const canFullEdit  = admin || isOwner || isGranted; // full content edit
  const canManage    = admin || isOwner || isDM;       // rename, move, perms, delete
  const canAppend    = isDM && !canFullEdit;           // DM on another user's note

  // Block editing of inherited world-layer notes (they need an override)
  if (note.source_note_id === null && !note.is_world) {
    // Check if this note is directly under a world layer (not an override)
    const parentNote = note.parent_id ? db.prepare('SELECT is_world FROM notes WHERE id = ?').get(note.parent_id) : null;
    const isWorldLayerNote = !parentNote && !note.parent_id;
    const rootData = db.prepare('SELECT is_world FROM notes WHERE id = ?').get(getRootFolderId(note.id));
    
    if (rootData && rootData.is_world === 1 && note.parent_id && !note.source_note_id && !isDM && !admin && !isOwner) {
      // This is an inherited world note and user is not a DM of world layer or campaign
      return res.status(403).json({ error: 'This note is from a world layer. Create a local override to edit.' });
    }
  }

  const { title, content, append_content, is_shared, category, color, parent_id, sort_order, tags, visibility, granted_users, cascade_children, significance, narrative_weight, client_updated_at, is_dm_only } = req.body;

  // Conflict detection — only for content/title edits, not structural ops
  if (client_updated_at && (content !== undefined || (title !== undefined && title !== note.title))) {
    const serverTs = new Date(note.updated_at).getTime();
    const clientTs = new Date(client_updated_at).getTime();
    if (serverTs > clientTs) {
      return res.status(409).json({
        error: 'conflict',
        server_title:      note.title,
        server_content:    note.content,
        server_updated_at: note.updated_at,
        server_updated_by: db.prepare('SELECT username FROM users WHERE id = ?').get(note.user_id)?.username,
      });
    }
  }

  // Reject if no applicable permission
  if (!canFullEdit && !canManage && !canAppend) {
    return res.status(403).json({ error: 'Not authorised to edit this note' });
  }

  // DM appending to another user's note
  if (append_content !== undefined && canAppend) {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const marker = `\n\n---\n*⚔ DM Addition by ${user.username} — ${date}:*\n`;
    const newContent = (note.content || '') + marker + append_content;
    db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newContent, note.id);
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
    res.json(withPermissions(withTags(updated)));
    if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
    return;
  }

  // Block direct content replacement if user can only append
  if (content !== undefined && canAppend && !canFullEdit) {
    return res.status(403).json({ error: 'DMs can only append to notes they do not own. Use append_content.' });
  }

  // Block structural changes if user has no manage rights
  const wantsRename = title !== undefined && title !== note.title;
  const wantsManage = wantsRename || parent_id !== undefined || visibility !== undefined || granted_users !== undefined;
  if (wantsManage && !canManage) {
    return res.status(403).json({ error: 'Not authorised to rename, move, or change permissions on this note' });
  }

  // Validate move to world layer: only root campaigns can be moved under worlds
  if (parent_id !== undefined && parent_id !== null && parent_id !== -1) {
    const target = db.prepare('SELECT is_world, parent_id, is_folder FROM notes WHERE id = ?').get(parent_id);
    if (target && target.is_world === 1) {
      // Moving under a world layer: source must be a root campaign (no parent, is_folder=1)
      if (note.parent_id !== null) {
        return res.status(400).json({ error: 'Only root campaigns can be moved under a world layer' });
      }
    }
  }

  const canChangePerms = admin || isOwner || isDM;

  const newVisibility = visibility !== undefined ? visibility
    : is_shared !== undefined ? (is_shared ? 'shared' : 'hidden')
    : null;

  db.prepare(`
    UPDATE notes SET
      title        = COALESCE(?, title),
      content      = CASE WHEN ? IS NOT NULL AND ? = 1 THEN ? ELSE content END,
      is_shared    = CASE WHEN ? IS NOT NULL THEN ? ELSE is_shared END,
      category     = COALESCE(?, category),
      color        = COALESCE(?, color),
      parent_id    = CASE WHEN ? = -1 THEN NULL WHEN ? IS NOT NULL THEN ? ELSE parent_id END,
      sort_order   = COALESCE(?, sort_order),
      visibility   = COALESCE(?, visibility),
      significance      = COALESCE(?, significance),
      narrative_weight  = COALESCE(?, narrative_weight),
      is_dm_only        = CASE WHEN ? IS NOT NULL THEN ? ELSE is_dm_only END,
      updated_at        = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    (canManage || canFullEdit) ? (title ?? null) : null,
    content !== undefined && canFullEdit ? 1 : null, content !== undefined && canFullEdit ? 1 : 0, content ?? null,
    is_shared !== undefined ? 1 : null, is_shared ? 1 : 0,
    canFullEdit ? (category ?? null) : null,
    canFullEdit ? (color ?? null) : null,
    canManage && parent_id === null ? -1 : null,
    canManage && parent_id !== undefined ? parent_id : null,
    canManage ? (parent_id ?? null) : null,
    sort_order ?? null,
    (canChangePerms && newVisibility) ? newVisibility : null,
    canFullEdit ? (significance ?? null) : null,
    canFullEdit ? (narrative_weight ?? null) : null,
    (canManage && is_dm_only !== undefined) ? 1 : null, is_dm_only ? 1 : 0,
    req.params.id
  );

  if (tags !== undefined && canFullEdit) saveTags(req.params.id, tags);

  // DM Only cascade — when flag changes, propagate to subtree and fix permissions
  const prevDmOnly = note.is_dm_only;
  const newDmOnly  = (canManage && is_dm_only !== undefined) ? (is_dm_only ? 1 : 0) : prevDmOnly;
  if (canManage && is_dm_only !== undefined && newDmOnly !== prevDmOnly) {
    // Build subtree (this note + all descendants)
    const subtree = [];
    const bfsQ = [parseInt(req.params.id)];
    while (bfsQ.length) {
      const pid = bfsQ.shift();
      subtree.push(pid);
      db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(pid).forEach(c => bfsQ.push(c.id));
    }

    // Find root campaign folder and its party members
    const rootId = getRootFolderId(parseInt(req.params.id));
    const partyMembers = rootId
      ? db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(rootId).map(r => r.user_id)
      : [];
    const dmUserIds = rootId
      ? new Set(db.prepare("SELECT user_id FROM folder_roles WHERE folder_id = ? AND role = 'dm'").all(rootId).map(r => r.user_id))
      : new Set();
    // Non-DM party members — their access is managed by the DM Only flag
    const regularMembers = partyMembers.filter(uid => !dmUserIds.has(uid));

    if (newDmOnly === 1) {
      // Cascade flag + strip regular member permissions from subtree
      // NEVER touch root folder's note_permissions — that's the party roster
      const cascade = db.transaction(() => {
        subtree.forEach(nid => {
          if (nid !== parseInt(req.params.id)) {
            db.prepare('UPDATE notes SET is_dm_only = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nid);
          }
          if (nid !== rootId) {
            regularMembers.forEach(uid => {
              db.prepare('DELETE FROM note_permissions WHERE note_id = ? AND user_id = ?').run(nid, uid);
            });
          }
        });
      });
      cascade();
    } else {
      // Cascade flag off + restore regular member permissions on subtree
      // NEVER touch root folder's note_permissions — that's the party roster
      const restore = db.transaction(() => {
        const grantStmt = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
        subtree.forEach(nid => {
          if (nid !== parseInt(req.params.id)) {
            db.prepare('UPDATE notes SET is_dm_only = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nid);
          }
          if (nid !== rootId) {
            regularMembers.forEach(uid => grantStmt.run(nid, uid));
          }
        });
      });
      restore();
    }
  }

  // When parent_id changes (move), inherit new folder's visibility + grants
  const isMove = canManage && parent_id !== undefined && parent_id !== note.parent_id;
  if (isMove) {
    const newParent = parent_id ? db.prepare('SELECT * FROM notes WHERE id = ?').get(parent_id) : null;
    const inheritedVisibility = newParent ? (newParent.visibility || 'hidden') : 'hidden';
    const inheritedGrants     = newParent
      ? db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(newParent.id).map(r => r.user_id)
      : [];

    const grantIns = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    const applyToSubtree = db.transaction((rootId) => {
      const queue = [rootId];
      while (queue.length) {
        const cur = queue.shift();
        db.prepare('UPDATE notes SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(inheritedVisibility, cur);
        db.prepare('DELETE FROM note_permissions WHERE note_id = ?').run(cur);
        inheritedGrants.forEach(uid => grantIns.run(cur, uid));
        db.prepare('SELECT id FROM notes WHERE parent_id = ?').all(cur).forEach(c => queue.push(c.id));
      }
    });
    applyToSubtree(parseInt(req.params.id));
  }

  // Update per-user grants if provided (owner, DM, or admin only)
  if (granted_users !== undefined && canChangePerms) {
    db.prepare('DELETE FROM note_permissions WHERE note_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    const insertAll = db.transaction((uids) => uids.forEach(uid => insert.run(req.params.id, uid)));
    insertAll(granted_users);
  }

  // Cascade visibility + grants to all children if requested
  if (cascade_children && newVisibility && canChangePerms) {
    const cascadeGrants = granted_users ?? db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(req.params.id).map(r => r.user_id);
    const cascadeDown = db.transaction((rootId) => {
      const queue = [rootId];
      while (queue.length) {
        const pid = queue.shift();
        const children = db.prepare('SELECT id FROM notes WHERE parent_id = ?').all(pid);
        children.forEach(child => {
          db.prepare('UPDATE notes SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVisibility, child.id);
          db.prepare('DELETE FROM note_permissions WHERE note_id = ?').run(child.id);
          const ins = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
          cascadeGrants.forEach(uid => ins.run(child.id, uid));
          queue.push(child.id);
        });
      }
    });
    cascadeDown(parseInt(req.params.id));
  }

  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json(withPermissions(withTags(updated)));
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

// DELETE note — soft delete, recoverable from trash
router.delete('/:id', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const note  = db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const isOwner = note.user_id === req.user.id;
  const isDM    = isDMOf(note.id, req.user.id);

  if (!admin && !isOwner && !isDM)
    return res.status(403).json({ error: 'Not authorised to delete this note' });

  // Soft-delete note and all descendants
  const softDeleteSubtree = db.transaction((rootId) => {
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift();
      db.prepare(`
        UPDATE notes SET
          deleted_at         = CURRENT_TIMESTAMP,
          original_parent_id = CASE WHEN original_parent_id IS NULL THEN parent_id ELSE original_parent_id END
        WHERE id = ?
      `).run(cur);
      db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(cur)
        .forEach(c => queue.push(c.id));
    }
  });
  softDeleteSubtree(parseInt(req.params.id));

  res.json({ success: true, id: note.id, title: note.title, is_folder: !!note.is_folder });
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

// GET trash — deleted items visible to the requesting user
// POST restore — bring note back, mark as recovered
router.post('/:id/restore', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const note  = db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found in trash' });
  const isOwner = note.user_id === req.user.id;
  const isDM    = isDMOf(note.id, req.user.id);
  if (!admin && !isOwner && !isDM) return res.status(403).json({ error: 'Not yours to restore' });

  const origParent = note.original_parent_id
    ? db.prepare('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL').get(note.original_parent_id)
    : null;
  const restoreParentId = origParent ? note.original_parent_id : null;
  const recoveredTitle  = note.title.includes('(Recovered)') ? note.title : `${note.title} (Recovered)`;

  db.prepare(`UPDATE notes SET deleted_at=NULL, original_parent_id=NULL, recovered=1, parent_id=?, title=? WHERE id=?`)
    .run(restoreParentId, recoveredTitle, note.id);

  const restored = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  res.json(restored);
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

// PUT campaign member management — DM or admin only, root folders only
router.put('/:id/members', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const folder = db.prepare('SELECT * FROM notes WHERE id = ? AND is_folder = 1 AND parent_id IS NULL').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Campaign folder not found' });

  const isDM = isDMOf(folder.id, req.user.id);
  if (!admin && !isDM) return res.status(403).json({ error: 'DM or admin only' });

  const { add_user_id, remove_user_id, set_dm } = req.body;

  if (add_user_id) {
    // Build the full campaign subtree
    const toGrant = [];
    const q = [folder.id];
    while (q.length) {
      const pid = q.shift();
      toGrant.push(pid);
      db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(pid).forEach(c => q.push(c.id));
    }
    // Grant access to all non-dm_only notes in the subtree
    const grantStmt = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');
    const grantAll = db.transaction(() => {
      toGrant.forEach(noteId => {
        const n = db.prepare('SELECT is_dm_only FROM notes WHERE id = ?').get(noteId);
        if (n && !n.is_dm_only) grantStmt.run(noteId, add_user_id);
      });
    });
    grantAll();
  }

  if (remove_user_id) {
    // Remove from root note_permissions, folder_roles, AND all child notes in this campaign
    const toClean = [folder.id];
    const queue = [folder.id];
    while (queue.length) {
      const pid = queue.shift();
      const children = db.prepare('SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL').all(pid);
      children.forEach(c => { toClean.push(c.id); queue.push(c.id); });
    }
    const delPerm = db.prepare('DELETE FROM note_permissions WHERE note_id = ? AND user_id = ?');
    const cleanAll = db.transaction(() => toClean.forEach(id => delPerm.run(id, remove_user_id)));
    cleanAll();
    db.prepare("DELETE FROM folder_roles WHERE folder_id = ? AND user_id = ?").run(folder.id, remove_user_id);
  }

  if (set_dm) {
    const { user_id, is_dm } = set_dm;
    // User must be a member to be set as DM
    const isMember = !!db.prepare('SELECT 1 FROM note_permissions WHERE note_id = ? AND user_id = ?').get(folder.id, user_id)
      || user_id === folder.user_id;
    if (!isMember) return res.status(400).json({ error: 'User must be a campaign member to be assigned as DM' });
    if (is_dm) {
      db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(folder.id, user_id);
    } else {
      db.prepare("DELETE FROM folder_roles WHERE folder_id = ? AND user_id = ?").run(folder.id, user_id);
    }
  }

  res.json({ ok: true });
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

// PUT clear recovered label — owner or admin
router.put('/:id/clear-recovered', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const note  = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const isOwner = note.user_id === req.user.id;
  const isDM    = isDMOf(note.id, req.user.id);
  if (!admin && !isOwner && !isDM) return res.status(403).json({ error: 'Not yours' });
  const cleanTitle = note.title.replace(/ \(Recovered\)/g, '').trim();
  db.prepare('UPDATE notes SET title=?, recovered=0 WHERE id=?').run(cleanTitle, note.id);
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  res.json(updated);
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

function saveTags(noteId, tags) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insert = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)');
  const insertAll = db.transaction((ts) => ts.forEach(t => {
    const clean = t.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-');
    if (clean) insert.run(noteId, clean);
  }));
  insertAll(tags || []);
}

// POST sync-visibility — cascade folder's visibility + permissions to all descendants
router.post('/:id/sync-visibility', authenticateToken, (req, res) => {
  const admin = isAdmin(req.user.id);
  const folder = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const isOwner = folder.user_id === req.user.id;
  const isDM    = isDMOf(folder.id, req.user.id);
  if (!admin && !isOwner && !isDM) return res.status(403).json({ error: 'Owner, DM, or admin only' });

  const visibility   = folder.visibility || 'hidden';
  const grants       = db.prepare('SELECT user_id FROM note_permissions WHERE note_id = ?').all(folder.id).map(r => r.user_id);
  const grantInsert  = db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)');

  // BFS through all descendants
  const queue    = [folder.id];
  let   synced   = 0;
  const syncAll  = db.transaction(() => {
    while (queue.length) {
      const parentId = queue.shift();
      const children = db.prepare('SELECT id FROM notes WHERE parent_id = ?').all(parentId);
      children.forEach(child => {
        db.prepare('UPDATE notes SET visibility = ? WHERE id = ?').run(visibility, child.id);
        db.prepare('DELETE FROM note_permissions WHERE note_id = ?').run(child.id);
        grants.forEach(uid => grantInsert.run(child.id, uid));
        synced++;
        queue.push(child.id);
      });
    }
  });
  syncAll();

  res.json({ success: true, synced });
  if (req.app.broadcast) req.app.broadcast({ type: 'notes_changed' });
});

module.exports = router;

