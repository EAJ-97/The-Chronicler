'use strict';
const bcrypt = require('bcryptjs');
const db = require('./database');

/** Generic demo account usernames created by ensureDemoUsers. */
const DEMO_USERNAMES = [
  'demo_dm',
  'demo_player1',
  'demo_player2',
  'demo_player3',
  'demo_player4',
  'demo_outsider',
];

/** Demo accounts excluded from world/campaign rosters (permission negative control). */
const DEMO_OUTSIDER_USERNAME = 'demo_outsider';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const noteId = {}; // name → db id, populated as we insert

/**
 * Resolves the demo seed password from env with a local-dev fallback.
 * @returns {string}
 */
function getDemoSeedPassword() {
  return process.env.DEMO_SEED_PASSWORD || 'demo1234';
}

/**
 * Creates or reuses generic demo users flagged users.is_demo = 1.
 * @returns {Promise<{ ids: Record<string, number>, password_hint: string }>}
 */
async function ensureDemoUsers() {
  const password = getDemoSeedPassword();
  const hash = await bcrypt.hash(password, 12);
  const ids = {};
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, is_admin, is_demo) VALUES (?, ?, 0, 1)'
  );
  const find = db.prepare('SELECT id FROM users WHERE username = ?');

  for (const username of DEMO_USERNAMES) {
    const existing = find.get(username);
    if (existing) {
      ids[username] = existing.id;
    } else {
      const r = insert.run(username, hash);
      ids[username] = r.lastInsertRowid;
    }
  }

  return { ids, password_hint: password };
}

/**
 * Inserts note_permissions for a user on a note (idempotent).
 * @param {number} userId
 * @param {number} noteId
 * @returns {void}
 */
function grantNote(userId, noteId) {
  db.prepare('INSERT OR IGNORE INTO note_permissions (note_id, user_id) VALUES (?, ?)').run(noteId, userId);
}

/**
 * Assigns DM folder role on a campaign/world root (idempotent).
 * @param {number} userId
 * @param {number} folderId
 * @returns {void}
 */
function grantDm(userId, folderId) {
  db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(folderId, userId);
}

/**
 * Grants a user access to every note id in a list (skips dm-only unless includeDmOnly).
 * @param {number} userId
 * @param {number[]} noteIds
 * @param {boolean} [includeDmOnly=false]
 * @returns {void}
 */
function grantNotes(userId, noteIds, includeDmOnly = false) {
  for (const nid of noteIds) {
    if (!includeDmOnly) {
      const row = db.prepare('SELECT is_dm_only FROM notes WHERE id = ?').get(nid);
      if (row?.is_dm_only) continue;
    }
    grantNote(userId, nid);
  }
}

/**
 * Collects all note ids in a folder subtree (inclusive).
 * @param {number} rootId
 * @returns {number[]}
 */
function collectSubtreeNoteIds(rootId) {
  const ids = [];
  const queue = [rootId];
  while (queue.length) {
    const pid = queue.shift();
    ids.push(pid);
    const children = db.prepare(
      'SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL'
    ).all(pid);
    for (const c of children) queue.push(c.id);
  }
  return ids;
}

/**
 * Collects note ids directly under a world root (world layer only, not nested campaigns).
 * Delegates to campaignMembers.collectScopedNoteIds so campaign folders are excluded.
 * @param {number} worldRootId
 * @returns {number[]}
 */
function collectWorldLayerNoteIds(worldRootId) {
  const { collectScopedNoteIds } = require('../utils/campaignMembers');
  return collectScopedNoteIds(worldRootId, 'world');
}

/**
 * Creates a demo folder row owned by the seeding admin (party-shared hidden visibility).
 * @param {string} title - Folder title
 * @param {number} ownerUserId - Admin user id
 * @param {string|null} parentKey - Key into noteId for parent, or null for root
 * @param {object} [opts] - is_world, visibility
 * @returns {number} New note id
 */
function mkFolder(title, ownerUserId, parentKey, opts = {}) {
  const parentId = parentKey ? noteId[parentKey] : null;
  const visibility = opts.visibility || 'hidden';
  const isWorld = opts.is_world ? 1 : 0;
  const r = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, is_folder, is_shared, visibility, category, narrative_weight, is_demo, is_world)
    VALUES (?, ?, ?, 1, 0, ?, 'general', 'node', 1, ?)
  `).run(ownerUserId, parentId, title, visibility, isWorld);
  return r.lastInsertRowid;
}

/**
 * Creates a demo note; optional opts.is_dm_only, opts.tags, opts.significance, opts.weight.
 * @param {string} key - Stable key stored in noteId
 * @param {string} title
 * @param {number} ownerUserId
 * @param {string|null} parentKey
 * @param {string} category
 * @param {string} content
 * @param {object} [opts]
 * @returns {number} New note id
 */
function mkNote(key, title, ownerUserId, parentKey, category, content, opts = {}) {
  const parentId = parentKey ? noteId[parentKey] : null;
  const dmOnly = opts.is_dm_only ? 1 : 0;
  const visibility = opts.visibility || 'hidden';
  const r = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_folder, is_shared, visibility, category, significance, narrative_weight, is_demo, is_dm_only)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 1, ?)
  `).run(
    ownerUserId, parentId, title, content,
    visibility,
    category,
    opts.significance || 'standard',
    opts.weight || 'node',
    dmOnly
  );
  noteId[key] = r.lastInsertRowid;
  if (opts.tags) {
    opts.tags.forEach(tag => {
      db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)").run(r.lastInsertRowid, tag);
    });
  }
  return r.lastInsertRowid;
}

/**
 * Creates a connection between two seeded notes; created_by is the admin user id.
 */
function mkConn(keyA, keyB, label, createdByUserId) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO connections (source_note_id, target_note_id, label, created_by)
      VALUES (?, ?, ?, ?)
    `).run(noteId[keyA], noteId[keyB], label, createdByUserId);
  } catch(e) { /* dupe, skip */ }
}

/**
 * Creates a demo session under a campaign journal folder key.
 */
function mkSession(folderKey, ts) {
  const r = db.prepare(
    "INSERT INTO sessions (folder_id, created_at, is_demo) VALUES (?, ?, ?)"
  ).run(noteId[folderKey], ts, 1);
  return r.lastInsertRowid;
}

/**
 * Appends a journal entry; author is always the seeding admin for consistent FK.
 */
function mkEntry(sessionId, folderKey, authorUserId, content, indent = 0, ts) {
  const maxOrder = db.prepare("SELECT MAX(sort_order) as m FROM journal_entries").get().m || 0;
  db.prepare(`
    INSERT INTO journal_entries (user_id, folder_id, session_id, content, indent_level, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(authorUserId, noteId[folderKey], sessionId, content, indent, maxOrder + 1, ts);
}

/**
 * Places a timeline event box on the Sunken Vale campaign axis.
 * @param {string} campaignKey - noteId key for campaign root (c1)
 * @param {string|null} noteKey - linked note key, or null for empty box
 * @param {number} createdByUserId
 * @param {number} anchor_x
 * @param {number} end_x
 * @param {number} end_y
 * @param {string} time_label
 * @returns {void}
 */
function mkTimelinePoint(campaignKey, noteKey, createdByUserId, anchor_x, end_x, end_y, time_label) {
  const folderId = noteId[campaignKey];
  const noteIdVal = noteKey ? noteId[noteKey] : null;
  db.prepare(`
    INSERT INTO timeline_points (
      folder_id, block_id, note_id, anchor_x, end_x, end_y, path_json,
      sort_order, time_label, label_override, created_by
    )
    VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)
  `).run(folderId, noteIdVal, anchor_x, end_x, end_y, anchor_x, time_label, createdByUserId);
}

/**
 * Removes all non-demo notes owned by demo accounts (legacy welcome folders, etc.).
 * @returns {void}
 */
function cleanupDemoUserPersonalNotes() {
  db.prepare('DELETE FROM notes WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1) AND is_demo = 0').run();
}
/**
 * Applies world/campaign roster grants and partial-grant scenarios for permission testing.
 * @param {number} adminUserId - Seeding admin
 * @param {Record<string, number>} demoIds - Username → user id from ensureDemoUsers
 * @returns {void}
 */
function applyDemoPermissions(adminUserId, demoIds) {
  const worldRoot = noteId.world;
  const campaignRoot = noteId.c1;
  const worldLayerIds = collectWorldLayerNoteIds(worldRoot);
  const campaignSubtreeIds = collectSubtreeNoteIds(campaignRoot);

  const worldMembers = [
    demoIds.demo_dm,
    demoIds.demo_player1,
    demoIds.demo_player2,
    demoIds.demo_player3,
  ];
  const campaignMembers = [
    demoIds.demo_dm,
    demoIds.demo_player1,
    demoIds.demo_player2,
    demoIds.demo_player3,
  ];
  const fullPartyPlayers = [
    demoIds.demo_player1,
    demoIds.demo_player2,
    demoIds.demo_player3,
  ];
  const partialPlayer3Exclude = new Set([noteId.castor, noteId.pale_hand].filter(Boolean));

  grantDm(adminUserId, campaignRoot);
  grantDm(demoIds.demo_dm, campaignRoot);

  for (const uid of worldMembers) {
    grantNotes(uid, worldLayerIds);
  }
  for (const uid of campaignMembers) {
    grantNote(uid, campaignRoot);
  }
  for (const uid of fullPartyPlayers) {
    for (const nid of campaignSubtreeIds) {
      if (partialPlayer3Exclude.has(nid) && uid === demoIds.demo_player3) continue;
      grantNotes(uid, [nid]);
    }
  }

  // Demo accounts are login-only test identities; no personal welcome folders.
}

/**
 * Backfills Sunken Vale timeline points when missing (idempotent).
 * @param {number} createdByUserId
 * @returns {void}
 */
function patchDemoTimeline(createdByUserId) {
  const campaign = db.prepare(
    "SELECT id FROM notes WHERE is_demo = 1 AND is_folder = 1 AND title = 'The Sunken Vale' AND deleted_at IS NULL LIMIT 1"
  ).get();
  if (!campaign) return;

  const count = db.prepare('SELECT COUNT(*) AS c FROM timeline_points WHERE folder_id = ?').get(campaign.id);
  if (count.c > 0) return;

  const noteByTitle = (title) => db.prepare(
    "SELECT id FROM notes WHERE is_demo = 1 AND title = ? AND deleted_at IS NULL AND is_folder = 0 LIMIT 1"
  ).get(title)?.id;

  const points = [
    { title: 'Veldrath City', anchor_x: 120, end_x: 40, end_y: -80, time_label: 'Year 0 — Founding' },
    { title: 'The Iron Covenant', anchor_x: 280, end_x: 200, end_y: 100, time_label: '60 years ago' },
    { title: 'The Gilded Anchor', anchor_x: 440, end_x: 360, end_y: -90, time_label: 'Session 1' },
    { title: 'The Ashwood', anchor_x: 600, end_x: 520, end_y: 110, time_label: 'Session 2' },
    { title: 'The Undercroft', anchor_x: 760, end_x: 680, end_y: -100, time_label: 'Session 3' },
    { title: 'Find the Source of the Corruption', anchor_x: 920, end_x: 840, end_y: 90, time_label: 'Present' },
    { title: 'The Sunken Vale', anchor_x: 1080, end_x: 1000, end_y: -110, time_label: 'Awakening' },
  ];

  const ins = db.prepare(`
    INSERT INTO timeline_points (
      folder_id, block_id, note_id, anchor_x, end_x, end_y, path_json,
      sort_order, time_label, label_override, created_by
    )
    VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)
  `);

  for (const p of points) {
    const nid = noteByTitle(p.title);
    if (!nid) continue;
    ins.run(campaign.id, nid, p.anchor_x, p.end_x, p.end_y, p.anchor_x, p.time_label, createdByUserId);
  }
}

// ---------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------
/**
 * Inserts cross-note markdown links into demo content for tutorials. Idempotent.
 * Safe to run on every boot when demo data already exists.
 */
function patchDemoNoteLinks() {
  const gilded = db
    .prepare(
      "SELECT id FROM notes WHERE is_demo = 1 AND title = 'The Gilded Anchor' AND deleted_at IS NULL LIMIT 1",
    )
    .get();
  const veldrath = db
    .prepare(
      "SELECT id, content FROM notes WHERE is_demo = 1 AND title = 'Veldrath City' AND deleted_at IS NULL LIMIT 1",
    )
    .get();
  const sunkenLoc = db
    .prepare(
      "SELECT id FROM notes WHERE is_demo = 1 AND title = 'The Sunken Vale' AND is_folder = 0 AND deleted_at IS NULL LIMIT 1",
    )
    .get();
  const qMain = db
    .prepare(
      "SELECT id, content FROM notes WHERE is_demo = 1 AND title = 'Find the Source of the Corruption' AND deleted_at IS NULL LIMIT 1",
    )
    .get();

  if (veldrath && gilded && !String(veldrath.content).includes(`note:${gilded.id}`)) {
    const next = String(veldrath.content).replace(
      "- The Gilded Anchor (Boldwin's inn, party base)",
      `- [The Gilded Anchor](note:${gilded.id}) (Boldwin's inn, party base)`,
    );
    if (next !== veldrath.content) {
      db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, veldrath.id);
    }
  }

  if (qMain && sunkenLoc && !String(qMain.content).includes(`note:${sunkenLoc.id}`)) {
    const next = String(qMain.content).replace(
      'The Sunken Vale is awakening.',
      `[The Sunken Vale](note:${sunkenLoc.id}) is awakening.`,
    );
    if (next !== qMain.content) {
      db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, qMain.id);
    }
  }

  const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').get();
  if (admin) patchDemoTimeline(admin.id);
}

/**
 * Inserts the full demo dataset owned by the given admin user.
 * Creates generic demo accounts, world + nested Sunken Vale, permissions, and timeline.
 * @param {number} adminUserId - Authenticated admin performing generate
 * @returns {Promise<{ skipped?: boolean, seeded?: boolean, patched?: boolean, demo_users?: object[] }>}
 */
async function seed(adminUserId) {
  const already = db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get();
  if (already?.value === 'true') {
    cleanupDemoUserPersonalNotes();
    patchDemoNoteLinks();
    return { skipped: true, patched: true };
  }

  const { ids: demoIds, password_hint } = await ensureDemoUsers();

  const run = db.transaction(() => {
    if (!adminUserId || !Number.isFinite(Number(adminUserId))) {
      throw new Error('seed requires a valid adminUserId');
    }
    const A = Number(adminUserId);

    cleanupDemoUserPersonalNotes();

    // ── WORLD: THE VELDRATH SETTING ───────────────────────────────────────
    noteId.world = mkFolder('The Veldrath Setting', A, null, { is_world: 1 });
    noteId.world_lore = mkFolder('World Lore', A, 'world');

    mkNote('world_overview', 'Veldrath Regional Overview', A, 'world_lore', 'lore', `## Veldrath Regional Overview
*World layer — shared setting bible*

The Veldrath coast is where trade routes from the eastern kingdoms meet the Vale River. Nobles in Highward preach stability while the Lows absorb every shock from cartel debt and cult whispers.

### Why This Matters
Campaigns set here inherit regional politics, the Iron Covenant's chokehold on shipping, and the Ashwood's slow awakening. DMs can run multiple tables in the same world without merging party secrets.

### Current Era
Lord Castor Mourne chairs the Trade Council. The Circle of the Root maintains ancient wards. Something older stirs beneath the Sunken Vale ruins east of the city.
`, { significance: 'major', weight: 'landmark', tags: ['world', 'veldrath', 'overview'] }),

    mkNote('world_founding', 'The Founding of Veldrath', A, 'world_lore', 'lore', `## The Founding of Veldrath
*World layer — historical primer*

Veldrath began as a fortress town guarding the Vale mouth. Merchants settled the lower terraces; the keep on the summit became Ironhold when the first lord sealed a pact with river pilots and smith guilds.

### The Vale Taboo
City records avoid discussing pre-Founding structures in the eastern valley. Archivists who pressed the question were reassigned — or vanished. The phrase **"the gate must not be fed"** appears in fragments predating the city's own ledgers.

### Modern Tensions
The Iron Covenant treats the river as an asset to acquire. Cult activity in the Lows is denied in council sessions. The Circle of the Root knows more than it shares with outsiders.
`, { significance: 'standard', weight: 'node', tags: ['world', 'history', 'veldrath'] }),

    mkNote('world_trade', 'Eastern Trade Routes', A, 'world_lore', 'lore', `## Eastern Trade Routes
*World layer — economic context*

Veldrath sits on the shortest saltwater path to the Borderlands and the Free Cities. Covenant factors have spent twelve years buying warehouses, pilots, and debt.

### Choke Points
- Vale River mouth (Veldrath docks)
- Ashwood northern passes (Circle-controlled, increasingly dangerous)
- Overland caravans through the Ironhold District toll gates

### For DMs
Use this note when players ask why everyone wants Veldrath. The Sunken Vale campaign assumes Covenant pressure is already acute.
`, { significance: 'standard', weight: 'node', tags: ['world', 'trade', 'covenant'] }),

    // ── CAMPAIGN: THE SUNKEN VALE (nested under world) ─────────────────────
    noteId.c1 = mkFolder('The Sunken Vale', A, 'world');

    // Sub-folders
    noteId['c1_npcs']      = mkFolder('NPCs',             A, 'c1');
    noteId['c1_locs']      = mkFolder('Locations',        A, 'c1');
    noteId['c1_factions']  = mkFolder('Factions',         A, 'c1');
    noteId['c1_items']     = mkFolder('Items & Artifacts', A, 'c1');
    noteId['c1_quests']    = mkFolder('Quests & Events',  A, 'c1');
    noteId['c1_lore']      = mkFolder('Lore & History',   A, 'c1');
    noteId['c1_journal']   = mkFolder('Session Journal',  A, 'c1');

    // ── NPCs ────────────────────────────────────────────────────────────────
    mkNote('castor', 'Lord Castor Mourne', A, 'c1_npcs', 'npc', `## Lord Castor Mourne
*Antagonist — Human Noble, 52*

Lord of Veldrath, publicly beloved, privately ruthless. Mourne inherited a crumbling estate and rebuilt it through brutal trade manipulation and the quiet backing of the Iron Covenant.

### Appearance
Tall and patrician. Silver-streaked hair, always immaculately dressed. Never seen without his signet ring — a coiled serpent eating its tail.

### Personality
- Charming in public, cold in private
- Believes the ends always justify the means
- Genuinely loves the city; just has a warped definition of what's good for it

### Known Information
- Chairs the Veldrath Trade Council
- His manor houses a private vault the party has been warned not to approach
- Has a standing arrangement with the Pale Hand — the exact nature is unknown

### What Only the DM Knows
He is the Hand's primary financier. He believes he controls them. He does not.

### Connections
- Commands Captain Halveth of the City Watch (reluctantly)
- Secretly funds the Pale Hand cult
- Owes significant favors to the Iron Covenant leadership
`, { significance: 'major', weight: 'landmark', tags: ['antagonist', 'noble', 'veldrath'] }),

    mkNote('mira', 'Mira the Fence', A, 'c1_npcs', 'npc', `## Mira the Fence
*Neutral — Half-elf, 38*

Information broker and fence operating out of the Gilded Anchor's cellar. Mira knows everything that moves through Veldrath — stolen goods, secrets, and sometimes people.

### Appearance
Short, wiry, with ink-stained fingers and a perpetual half-smile. Dresses like a dockworker but her rings are worth more than most guards make in a year.

### Personality
- Purely transactional — she doesn't pick sides, she picks profits
- Surprisingly good-humored given her line of work
- Will sell anyone out for the right price, but has a personal code against endangering children

### What the Party Knows
- She sold Brennan information about the missing shipments
- She has contacts in both the Iron Covenant and the Pale Hand
- She is nervous about something she hasn't named yet

### Useful Services
- Can identify magical items (for a fee)
- Has access to a fence network spanning three cities
- Occasionally forges documents
`, { significance: 'major', weight: 'node', tags: ['ally', 'information', 'half-elf'] }),

    mkNote('halveth', 'Captain Dren Halveth', A, 'c1_npcs', 'npc', `## Captain Dren Halveth
*Complex NPC — Human, 45*

Captain of the Veldrath City Watch. A good man in an impossible position. He suspects Lord Mourne is corrupt but lacks proof, and his family's safety depends on his cooperation.

### Appearance
Stocky, scarred jaw, tired eyes. Keeps his uniform impeccable as a point of pride.

### Current Motivation
Protect his daughter Sera (age 9) from the veiled threat Mourne made three months ago. If the party can secure her safety, Halveth becomes a powerful ally.

### What He Knows
- The guard rotation schedules for Ironhold Keep
- That three shipments were rerouted by Covenant orders
- The location of Mourne's secondary safe house on the east docks

### Warning
Do NOT push him into a corner publicly. He will choose his daughter every time.
`, { significance: 'major', weight: 'node', tags: ['city watch', 'ally potential', 'complex'] }),

    mkNote('sylvaine', 'Elder Sylvaine', A, 'c1_npcs', 'npc', `## Elder Sylvaine
*Neutral — Wood Elf, 340*

Leader of the Circle of the Root. Ancient, patient, and deeply unsettled by whatever is happening in the Ashwood. She does not scare easily. She is scared.

### Appearance
Weathered bark-brown skin, hair woven with living moss. Moves slowly and deliberately. Her left eye is clouded — a wound from the last Corruption surge forty years ago.

### What She Wants
- The source of the Ashwood corruption identified and stopped
- The party to not touch the Standing Stones under any circumstances
- To speak with someone who has seen the Pale Watcher

### What She Can Offer
- Safe passage through the Ashwood
- Healing and rest at the Circle's Grove
- Knowledge of the Vale's ancient history (see Lore notes)

> *"The forest remembers things the city has chosen to forget. It is remembering again."*
`, { significance: 'major', weight: 'node', tags: ['druid', 'elder', 'circle of the root'] }),

    mkNote('breck', 'Thane Breck', A, 'c1_npcs', 'npc', `## Thane Breck
*Ally — Dwarf, 187*

Master smith in the Ironhold District. Gruff, honest, and currently in debt to the Iron Covenant for a loan he can't repay. Has been forging substandard weapons for the watch under duress.

### Appearance
Barrel-chested, braided red beard starting to go grey. Burns on both forearms from decades at the forge. Never makes eye contact when uncomfortable.

### His Problem
The Covenant took his apprentice Tolm as "collateral." Tolm is 16. Breck will do anything to get him back — including help the party break into the Covenant's riverside warehouse.

### What He Can Do For the Party
- Masterwork weapon repairs (free, if Tolm is rescued)
- Access to the Ironhold Keep's maintenance tunnels (he built them)
- Identify weapon quality and maker's marks
`, { significance: 'standard', weight: 'node', tags: ['smith', 'ally', 'dwarf'] }),

    mkNote('pale_watcher', 'The Pale Watcher', A, 'c1_npcs', 'npc', `## The Pale Watcher
*Major Antagonist — Unknown*

A figure that has appeared three times at the edges of scenes. Never speaks. Never attacks. Watches, then vanishes. The party has begun to dread it.

### Sightings
1. Standing at the edge of the Ashwood as the party entered — gone when Lira looked back
2. Reflected in the water of the Undercroft cistern — nothing there when they looked
3. Brennan glimpsed it outside his window at the Gilded Anchor at 3am

### Physical Description
- Roughly human-shaped, entirely white — skin, clothing, hair
- No visible eyes — just smooth skin where they should be
- Approximately 7 feet tall
- Casts no shadow

### What the DM Knows
It is not a person. It is a manifestation of the Corruption given form by the cult's rituals. It cannot act directly yet — the party's presence is disrupting the ritual completion.

### Party Theory
Sable thinks it's a Pale Hand assassin. Brennan thinks it's undead. Lira is keeping her theory to herself.
`, { significance: 'major', weight: 'landmark', tags: ['antagonist', 'mysterious', 'corruption'] }),

    mkNote('boldwin', 'Innkeeper Boldwin', A, 'c1_npcs', 'npc', `## Innkeeper Boldwin Cask
*Friendly NPC — Human, 61*

Owner of the Gilded Anchor. Has been running this inn for 30 years and has seen everything. Asks no questions, remembers everything, and makes the best lamb stew in Veldrath.

### Personality
Warm, gossipy in a harmless way, fiercely protective of his regulars.

### Useful
- Can relay messages discreetly
- Knows which guard patrols take bribes
- Has a hidden room the party can use (ask nicely)

*"I didn't see nothing. But if I had, I'd have remembered it real well."*
`, { significance: 'minor', weight: 'detail', tags: ['friendly', 'innkeeper'] }),

    // ── LOCATIONS ───────────────────────────────────────────────────────────
    mkNote('veldrath', 'Veldrath City', A, 'c1_locs', 'location', `## Veldrath
*Major Hub — Coastal Trade City, Pop. ~14,000*

A prosperous port city at the mouth of the Vale River. Beautiful from a distance — layered white stone climbing a hillside to Ironhold Keep at the summit. Up close, the lower districts are crowded and tense.

### Districts
- **Highward** — noble estates, the Keep, the Trade Council hall
- **Ironhold District** — smiths, craftsmen, Breck's forge
- **The Docks** — trade, fishing, Mira's operation
- **The Lows** — poorest quarter, where the Pale Hand recruits

### Current Tensions
The Iron Covenant has been quietly buying up Lows properties. Residents are being pressured to relocate. No one in Highward seems concerned.

### Notable Locations
- The Gilded Anchor (Boldwin's inn, party base)
- The Undercroft (thieves' network, accessed via the old sewers)
- The Trade Council Hall (Mourne's seat of power)
- Ironhold Keep (Lord Mourne's residence + city fortress)
`, { significance: 'major', weight: 'landmark', tags: ['city', 'hub', 'veldrath'] }),

    mkNote('sunken_vale', 'The Sunken Vale', A, 'c1_locs', 'location', `## The Sunken Vale
*Dungeon Area — Ancient Flooded Ruins*

Three miles east of Veldrath, where the Vale River splits around a collapsed hillside. The ruins of an old settlement lie half-submerged beneath perpetually dark water. Strange lights have been reported at night.

### What's Known
- The ruins predate Veldrath by at least 400 years
- Elder Sylvaine says they were a waystation for something older
- The Iron Covenant sent a survey team 6 weeks ago. Only two returned.

### Encountered So Far
- The entry hall is navigable but partially flooded (waist-deep)
- Something large moves in the deeper chambers
- The walls are carved with script that Lira partially translated — "the gate must not be fed"

### Current Status
The party has explored the outer chambers. The inner vault remains sealed.
`, { significance: 'major', weight: 'landmark', tags: ['dungeon', 'ruins', 'main quest'] }),

    mkNote('ashwood', 'The Ashwood', A, 'c1_locs', 'location', `## The Ashwood
*Dangerous Wilderness — Ancient Forest*

A vast forest beginning a mile north of Veldrath. The Circle of the Root maintains the old paths. Since the Corruption began spreading, the forest has become increasingly hostile to outsiders — and apparently to the Circle itself.

### Known Dangers
- The trees on the northern edge have begun to move (slowly, but measurably)
- Three hunters have gone missing in the past month
- Sylvaine's outriders report finding Standing Stones they don't recognize

### Points of Interest
- **The Circle's Grove** — safe haven, Sylvaine's base
- **The Watching Hill** — highest point, good vantage, but something watches back
- **The Old Road** — fastest path to the Vale, increasingly overgrown
`, { significance: 'major', weight: 'node', tags: ['forest', 'danger', 'corruption'] }),

    mkNote('gilded_anchor', 'The Gilded Anchor', A, 'c1_locs', 'location', `## The Gilded Anchor
*Inn & Tavern — Docks District*

The party's base of operations. Three floors, 12 rooms, a common room that smells permanently of woodsmoke and ale, and a cellar that connects to Mira's operation.

### Party's Rooms
- Room 4 (Sable) — faces the street, good for watching
- Room 7 (Brennan) — the one with the window the Watcher appeared at
- Room 9 (Lira) — corner room, best light for reading

### House Rules (Boldwin's)
No blood on the good tables. Pay on Tenthday. Don't ask about the cellar.

### Cellar Access
The hidden door behind the ale barrels leads down to Mira's space. Knock twice, pause, knock three times.
`, { significance: 'standard', weight: 'node', tags: ['base', 'inn', 'docks'] }),

    mkNote('ironhold', 'Ironhold Keep', A, 'c1_locs', 'location', `## Ironhold Keep
*Lord Mourne's Stronghold — City Summit*

The original fortress of Veldrath, now serving as Mourne's residence, the city treasury, and the official seat of the Trade Council. Heavily guarded — 40 guards, rotation every 4 hours.

### Known Entry Points
- Main gate (obvious, not recommended)
- Kitchen delivery entrance (used Tenthday mornings)
- Breck's maintenance tunnels (requires his cooperation)
- The old aqueduct (Halveth mentioned it, not confirmed navigable)

### Points of Interest Inside
- The Great Hall (Trade Council meetings)
- The Vault (sub-basement, Mourne's private documents)
- The Watcher's Tower (northeastern turret — guards avoid it)

### Security
Halveth runs the rotation. He will warn the party if asked — once.
`, { significance: 'major', weight: 'node', tags: ['stronghold', 'mourne', 'infiltration'] }),

    mkNote('undercroft', 'The Undercroft', A, 'c1_locs', 'location', `## The Undercroft
*Criminal Network Hub — Old Sewers*

Accessible via three entry points in the Lows. A thieves' network has operated here for decades. Not malicious by nature — more a gray market and information exchange. Recently the Pale Hand has been moving through their tunnels without permission, and the network is not happy about it.

### Entry Points
1. The Lows fishmonger (ask for "the catch from below")
2. Old drainage grate behind the tannery  
3. Mira's cellar connection (requires her introduction)

### Notable Areas
- The Exchange (where goods and information are traded)
- The Cistern (where Brennan saw the Watcher's reflection)
- The Deep Tunnels (Pale Hand territory now — party has not gone further)
`, { significance: 'major', weight: 'node', tags: ['criminal', 'sewers', 'pale hand'] }),

    // ── FACTIONS ────────────────────────────────────────────────────────────
    mkNote('iron_covenant', 'The Iron Covenant', A, 'c1_factions', 'faction', `## The Iron Covenant
*Antagonist Faction — Merchant Cartel*

A trade consortium that has controlled shipping routes across three kingdoms for sixty years. Publicly they are a legitimate merchant guild. In practice they are a cartel that uses debt, intimidation, and occasionally violence to maintain monopoly control.

### Leadership
- **Guildmaster Orren Vask** — based in Ashport, rarely seen in Veldrath
- **Factor Elene Dray** — Veldrath's local representative, cold and precise
- **Enforcer Kael** — handles "difficult negotiations"

### Their Interest in Veldrath
The Vale River trade route is the most efficient path to the eastern markets. Whoever controls it controls the eastern economy. The Covenant has been systematically buying access to every choke point.

### Connection to the Pale Hand
Unknown to most members. The leadership is funding the Hand's ritual as a "contingency." If the ritual succeeds, the chaos it creates would let them buy Veldrath at crisis prices.

### Pressure Points
- Three factors below Dray are deeply uncomfortable with the Pale Hand arrangement
- The Covenant's charter requires majority vote for major expenditures — the Hand funding is off-book
`, { significance: 'major', weight: 'landmark', tags: ['antagonist', 'merchant', 'cartel'] }),

    mkNote('circle_root', 'Circle of the Root', A, 'c1_factions', 'faction', `## Circle of the Root
*Ally Faction — Druid Order*

Ancient order of druids who maintain the Ashwood and the old wards that keep the Vale's corruption contained. They have been doing this work largely unrecognized for centuries.

### Current Status
Three of their eight wardens have gone missing in the corrupted zones. Sylvaine is sending younger members to do the work older ones used to handle, and it shows.

### What They Need
- Someone to investigate the new Standing Stones
- Help recovering their missing wardens (two are confirmed dead, one unknown)
- Proof of who is conducting the ritual, for the Elder's council records

### What They Offer
- Safe passage and rest in the Ashwood
- Healing magic (limited)
- Historical knowledge of the Vale
- The location of the old ward stones — which could theoretically be used to accelerate the Corruption if the ritual casters found them
`, { significance: 'major', weight: 'node', tags: ['ally', 'druid', 'ashwood'] }),

    mkNote('pale_hand', 'The Pale Hand', A, 'c1_factions', 'faction', `## The Pale Hand
*Primary Antagonist Faction — Cult*

A cult dedicated to an entity they call the Pale Beneath — something old that was sealed in the Sunken Vale ruins long before Veldrath was built. Their goal is to complete a ritual that will unseal the entity and allow it to manifest.

### True Numbers
Larger than the party thinks. Not just the ragged zealots in the Lows. Includes merchants, two city guard lieutenants, and at least one Trade Council member.

### The Ritual
Requires: the Shard of Echoes (currently in the Vale's inner vault), the blood of someone who has seen the Pale Watcher willingly, and completion of the binding circle at the Standing Stones.

### Weak Points
- The cult's inner circle has begun to fracture over timing
- Three newer members didn't realize human sacrifice was involved and are having doubts
- Their tunnel network in the Undercroft is newly established and not secured

### The Watcher
Is NOT under their control, despite what they believe. It is using them.
`, { significance: 'major', weight: 'landmark', tags: ['cult', 'antagonist', 'corruption'] }),

    // ── ITEMS ────────────────────────────────────────────────────────────────
    mkNote('shard', 'The Shard of Echoes', A, 'c1_items', 'item', `## The Shard of Echoes
*Major Artifact — Quest Item*

A fragment of translucent pale stone, roughly hand-sized, that emits a faint hum when held. It resonates more intensely near areas of corruption. Currently locked in the Sunken Vale's inner vault.

### Properties
- Warm to the touch despite appearing to be stone
- Anyone holding it for more than a minute begins to hear whispers — not words, but emotional impressions
- Lira identified the material as pre-Founding stonework, which shouldn't exist

### Why the Cult Needs It
The Shard is a focusing lens for the ritual. Without it, the binding circle cannot be completed. The party needs to either retrieve it or destroy it.

### Can It Be Destroyed?
Unknown. Standard damage doesn't affect it. Sylvaine thinks the old ward stones might be able to unmake it, but that process would also accelerate local corruption temporarily.

### Lira's Notes
*"The humming changes pitch near running water. It changed again near Brennan after his encounter with the Watcher. I haven't told the others yet."*
`, { significance: 'major', weight: 'landmark', tags: ['artifact', 'quest item', 'ritual'] }),

    mkNote('brecks_blade', "Breck's Masterwork", A, 'c1_items', 'item', `## Breck's Masterwork Blade
*Item — Masterwork Longsword*

A longsword Breck forged as his journeyman piece 40 years ago — never sold, because he could never decide on a fair price for it. He has offered it to the party if Tolm is rescued.

### Properties
- Masterwork quality (+1 to attack rolls, non-magical)
- Unusually well-balanced — Breck says he "got lucky with the cooling"
- The crossguard is shaped like two clasped hands

### Current Status
Offered but not yet given. The rescue of Tolm is incomplete.
`, { significance: 'minor', weight: 'detail', tags: ['weapon', 'reward', 'breck'] }),

    mkNote('watcher_sigil', "The Pale Watcher's Sigil", A, 'c1_items', 'item', `## The Pale Watcher's Sigil
*Item — Cult Object, Dangerous*

A small disk of pale stone found on a Pale Hand cultist the party incapacitated in the Undercroft. Identical material to the Shard of Echoes. Carved with a symbol that Lira cannot fully look at directly.

### What's Known
- The cultist panicked when they saw the party had it
- It becomes cold when the Watcher is nearby
- Lira tried to sketch the symbol and found her hand shaking — the sketch doesn't match what she sees when she looks at the real thing

### DM Notes
It is a minor anchor point for the Watcher's presence. Destroying it will not harm the Watcher but will make it slightly less able to observe the party. They won't know this unless they experiment.
`, { significance: 'standard', weight: 'node', tags: ['cult object', 'pale hand', 'mysterious'] }),

    mkNote('scroll_unseal', 'Scroll of Unsealing', A, 'c1_items', 'item', `## Scroll of Unsealing
*Item — Magic Scroll (6th Level)*

Found in the Sunken Vale's outer chamber, inside a waterproof case. Written in old Elvish. Lira has identified it as a dispel-and-open working powerful enough to override most magical locks.

### Properties
- One use
- Requires one action to activate
- Will open any magically sealed door or container up to 6th-level enchantment
- Has no effect on mundane locks

### Likely Use
The inner vault of the Sunken Vale is sealed with what appears to be a 5th-level ward. This scroll will open it. The question is whether to use it there or save it for Ironhold Keep.

### Condition
Slightly water-damaged on the outer edge. Lira believes it's still functional.
`, { significance: 'standard', weight: 'node', tags: ['scroll', 'magic', 'dungeon'] }),

    // ── QUESTS ──────────────────────────────────────────────────────────────
    mkNote('q_main', 'Find the Source of the Corruption', A, 'c1_quests', 'event', `## MAIN QUEST: Find the Source of the Corruption
*Status: Active — Session 3 Breakthrough*

The Ashwood is dying. The Sunken Vale is awakening. Something old is being invited back into the world by people who don't understand what they're actually inviting.

### Current Understanding
The corruption is ritual-driven, not natural. The Pale Hand is conducting a multi-stage ritual to unseal an entity in the Vale. The final stage requires the Shard of Echoes and the completion of the binding circle at the Standing Stones.

### Next Steps
1. Retrieve or destroy the Shard (requires opening the inner vault)
2. Locate the Standing Stones (Sylvaine may know)
3. Identify and confront the ritual leader before the binding circle is completed

### Party Debate
- Sable wants to destroy the Shard immediately
- Brennan wants to understand it first
- Lira wants to know if destroying it would free whatever is already partially through
`, { significance: 'major', weight: 'landmark', tags: ['main quest', 'corruption', 'pale hand'] }),

    mkNote('q_shipments', 'The Missing Shipments', A, 'c1_quests', 'event', `## SIDE QUEST: The Missing Shipments
*Status: Partially Resolved*

Three supply shipments meant for the Circle of the Root were rerouted by Iron Covenant factors. The Circle's provisions for their missing wardens never arrived. One shipment included warding components that would have significantly helped contain the corruption spread.

### What the Party Found
- Mira confirmed the rerouting was on Covenant orders, specifically Factor Dray
- Two of the three shipments have been located in a Covenant warehouse on the east docks
- The third (containing the warding components) has been moved again — current location unknown

### Resolved
Brennan retrieved the provisions from the warehouse (Session 2). The warding components are still missing.

### Leads
- Kael the Enforcer was seen moving the third shipment personally
- A dockworker named Hess saw where it went but is scared to talk
`, { significance: 'standard', weight: 'node', tags: ['side quest', 'iron covenant', 'circle'] }),

    mkNote('q_tolm', "Breck's Debt & Tolm", A, 'c1_quests', 'event', `## SIDE QUEST: Free Tolm from the Covenant
*Status: Active*

Breck's apprentice Tolm (16) is being held by the Iron Covenant as collateral against Breck's debt. Breck has been forging substandard weapons for the City Watch as a result.

### Current Info
- Tolm is being held at the Covenant's counting house in the Ironhold District
- He is unharmed but watched constantly
- The debt is 340 gold — Breck borrowed to repair the forge after a fire

### Options
1. Pay the debt (party doesn't have 340g currently)
2. Steal Tolm out of the counting house
3. Destroy Covenant's leverage on Breck by exposing the substandard weapons — nuclear option, would implicate Breck too

### Reward
Breck's Masterwork Blade + access to the Keep's maintenance tunnels.
`, { significance: 'standard', weight: 'node', tags: ['side quest', 'rescue', 'breck'] }),

    // ── LORE ────────────────────────────────────────────────────────────────
    mkNote('lore_vale', "The Vale's Ancient History", A, 'c1_lore', 'lore', `## The Ancient History of the Vale
*Research Notes — Lira Voss*

Cross-referencing Sylvaine's oral histories with the wall carvings from the Sunken Vale outer chambers.

### Pre-Founding Period (~600+ years ago)
The valley predates Veldrath by at least three centuries. The ruins in the Vale were not a settlement — they were a **containment structure**. Whatever was sealed there was sealed deliberately, and the people who built the structure knew they were sacrificing the land to do it.

### The First Sealing
Sylvaine calls it the First Quieting. A convergence of druid orders and what she calls the "stone-speakers" (possibly a now-extinct mage tradition) performed a multi-generational ward that eventually went dormant as the entity it contained "went to sleep."

### The Inscription
The phrase "the gate must not be fed" appears seven times in the outer chamber. Lira's translation of adjacent text: *"hunger is not malice — but hunger without direction becomes the same thing."*

### Implication
The entity in the Vale is not evil in the conventional sense. It is simply vast and hungry, and being fed by the ritual is waking it in a direction it would not have chosen.

### Open Questions
- What exactly is it?
- Can it be re-sealed, or only destroyed?
- Who built the containment structure and what happened to them?
`, { significance: 'major', weight: 'node', tags: ['lore', 'history', 'vale', 'research'] }),

    mkNote('lore_old_gods', 'The Old Gods of the Ashwood', A, 'c1_lore', 'lore', `## The Old Gods of the Ashwood
*As Recorded by Elder Sylvaine — Transcribed by Lira*

The Ashwood remembers names the city has forgotten. There were presences here before the First Quieting — not gods as humans understand them, but something the early druids called "the Weight of Old Green."

### The Weight
Not a single entity but a collective memory. The forest itself as a slow consciousness. The druids of the Circle have always maintained the old relationship — leaving offerings, listening to the deep patterns in root and branch.

### What's Happening Now
The corruption is not attacking the Weight directly. It is confusing it. The entity in the Vale, as it wakes, broadcasts something the forest interprets as a summons. The trees that have begun to move are responding — not maliciously, but blindly.

### Sylvaine's Fear
*"If the entity wakes fully before we can re-seal it, the forest will not distinguish between the Pale Hand and us. The Weight does not think in terms of good and evil. It will defend itself from everything unfamiliar."*

### Practical Notes
The old grove at the heart of the Ashwood — the one the Circle's maps mark as off-limits — is the last place the Weight's concentration is coherent. Sylvaine believes it might serve as a focal point for any attempt at re-sealing.
`, { significance: 'major', weight: 'node', tags: ['lore', 'ashwood', 'druid', 'old gods'] }),

    mkNote('lore_covenant', "The Covenant's True Purpose", A, 'c1_lore', 'lore', `## The Iron Covenant's True Purpose
*DM Reference — Not Player Knowledge*

The Iron Covenant was founded sixty years ago by three merchant families who recognized that conventional competition was inefficient. Their original charter is a masterpiece of deliberately vague language that has allowed progressive expansion of what counts as "legitimate trade enforcement."

### How They Actually Work
1. Identify a trade route or resource that is profitable but not yet controlled
2. Extend easy credit to existing operators
3. When debt becomes unsustainable, acquire the operation at crisis prices
4. Use the newly acquired leverage to control adjacent operations

### The Veldrath Play
Veldrath's eastern river access is the crown jewel. They've been running the above playbook for 12 years. Mourne's arrangement with them is part of this — he took their money to restore his estate, and has been slowly ceding trade authority ever since.

### The Pale Hand Gamble
Guildmaster Vask made the decision personally. If the ritual succeeds and causes chaos in Veldrath, the Covenant is positioned to buy the city's key infrastructure during the recovery period. It is monstrous. Vask knows it is monstrous. He did the math anyway.

### The Party Doesn't Know
Factor Dray was not informed of the Pale Hand arrangement. She is operating in good faith on the Veldrath takeover and would be horrified by the ritual. She is a potential lever if the party finds this out.
`, { significance: 'major', weight: 'node', tags: ['lore', 'iron covenant', 'dm only'], is_dm_only: true }),

    // ── CONNECTIONS ─────────────────────────────────────────────────────────
    mkConn('castor',       'iron_covenant',  'financed by',       A);
    mkConn('castor',       'pale_hand',      'secret financier',  A);
    mkConn('castor',       'halveth',        'commands',          A);
    mkConn('castor',       'ironhold',       'resides in',        A);
    mkConn('pale_watcher', 'pale_hand',      'entity behind',     A);
    mkConn('pale_watcher', 'shard',          'bound to',          A);
    mkConn('pale_hand',    'undercroft',     'operates through',  A);
    mkConn('pale_hand',    'sunken_vale',    'conducting ritual', A);
    mkConn('iron_covenant','pale_hand',      'secretly funding',  A);
    mkConn('iron_covenant','breck',          'holds debt over',   A);
    mkConn('mira',         'undercroft',     'operates from',     A);
    mkConn('mira',         'gilded_anchor',  'based at',          A);
    mkConn('halveth',      'ironhold',       'commands guard at', A);
    mkConn('sylvaine',     'circle_root',    'leads',             A);
    mkConn('sylvaine',     'ashwood',        'protects',          A);
    mkConn('circle_root',  'ashwood',        'maintains',         A);
    mkConn('breck',        'ironhold',       'built tunnels under', A);
    mkConn('shard',        'sunken_vale',    'sealed within',     A);
    mkConn('shard',        'watcher_sigil',  'same material',     A);
    mkConn('q_main',       'sunken_vale',    'centered on',       A);
    mkConn('q_main',       'pale_hand',      'blocked by',        A);
    mkConn('q_tolm',       'breck',          'concerns',          A);
    mkConn('q_shipments',  'circle_root',    'affected',          A);
    mkConn('lore_vale',    'sunken_vale',    'documents',         A);
    mkConn('lore_old_gods','ashwood',        'describes',         A);
    mkConn('veldrath',     'gilded_anchor',  'contains',          A);
    mkConn('veldrath',     'ironhold',       'dominated by',      A);
    mkConn('veldrath',     'undercroft',     'underlies',         A);
    mkConn('boldwin',      'gilded_anchor',  'owns',              A);

    // ── TIMELINE: SUNKEN VALE ─────────────────────────────────────────────
    mkTimelinePoint('c1', 'veldrath', A, 120, 40, -80, 'Year 0 — Founding');
    mkTimelinePoint('c1', 'iron_covenant', A, 280, 200, 100, '60 years ago');
    mkTimelinePoint('c1', 'gilded_anchor', A, 440, 360, -90, 'Session 1');
    mkTimelinePoint('c1', 'ashwood', A, 600, 520, 110, 'Session 2');
    mkTimelinePoint('c1', 'undercroft', A, 760, 680, -100, 'Session 3');
    mkTimelinePoint('c1', 'q_main', A, 920, 840, 90, 'Present');
    mkTimelinePoint('c1', 'sunken_vale', A, 1080, 1000, -110, 'Awakening');

    // ── JOURNAL: CAMPAIGN 1 ──────────────────────────────────────────────
    const s1 = mkSession('c1', '2025-01-15 18:00:00');
    mkEntry(s1,'c1',A,'Session 1 — "The Gilded Anchor" — Jan 15',0,'2025-01-15 18:00:00');
    mkEntry(s1,'c1',A,"Party arrived in Veldrath by merchant ship. Sable immediately cased the docks. Brennan got in an argument with a dockworker that nearly became a fight.",0,'2025-01-15 18:05:00');
    mkEntry(s1,'c1',A,'That dockworker was definitely watching us.',1,'2025-01-15 18:06:00');
    mkEntry(s1,'c1',A,"He was just annoyed I bumped his cart. Probably.",1,'2025-01-15 18:07:00');
    mkEntry(s1,'c1',A,'Checked into the Gilded Anchor. Boldwin gave them rooms 4, 7, and 9. Lira immediately went to the library, was back by nightfall with notes on the Sunken Vale.',0,'2025-01-15 18:15:00');
    mkEntry(s1,'c1',A,"The librarian was unhelpful but the archive wasn't locked. Found three references to pre-Founding structures in the valley. The Veldrath city records actively avoid mentioning them.",1,'2025-01-15 18:16:00');
    mkEntry(s1,'c1',A,'Cross-reference: the phrase "the gate must not be fed" appears in two separate documents, neither of which cites the other. Predates city record keeping.',2,'2025-01-15 18:17:00');
    mkEntry(s1,'c1',A,'Evening: Party met Mira in the Gilded Anchor cellar. She had been warned they were coming (by whom she declined to say). Sold them the basic intelligence package — Mourne, Halveth, the Covenant\'s interests.',0,'2025-01-15 18:30:00');
    mkEntry(s1,'c1',A,'She knows more than she\'s selling. Watch her hands when she talks about the Pale Hand — she\'s careful.',1,'2025-01-15 18:31:00');
    mkEntry(s1,'c1',A,"Late night: Brennan saw the figure at his window. White. Still. Gone when he blinked. Party spent an uncomfortable hour discussing what it was. No consensus. Lira wrote down the description.",0,'2025-01-15 19:00:00');
    mkEntry(s1,'c1',A,"I know what I saw.",1,'2025-01-15 19:01:00');
    mkEntry(s1,'c1',A,'Noted.',1,'2025-01-15 19:02:00');

    const s2 = mkSession('c1', '2025-01-22 18:00:00');
    mkEntry(s2,'c1',A,'Session 2 — "Into the Ashwood" — Jan 22',0,'2025-01-22 18:00:00');
    mkEntry(s2,'c1',A,"Traveled north to meet Elder Sylvaine. The forest felt wrong from the first mile in — too quiet, then briefly too loud in the wrong ways. No birds after the first hour.",0,'2025-01-22 18:05:00');
    mkEntry(s2,'c1',A,'The trees on the north edge have moved. I paced off the old path against the survey map Sylvaine gave me. 11 feet of deviation over approximately 200 yards. Whatever is moving them is doing it slowly and consistently.',1,'2025-01-22 18:06:00');
    mkEntry(s2,'c1',A,"Lira, how long has that been happening?",1,'2025-01-22 18:07:00');
    mkEntry(s2,'c1',A,"Based on the rate? At least 8 months. Before any of the other incidents.",1,'2025-01-22 18:08:00');
    mkEntry(s2,'c1',A,"Met Sylvaine at the Circle's Grove. She was expecting them. Session included a long roleplay exchange — Sylvaine gave significant lore about the First Quieting. Lira asked most of the right questions. Brennan asked about the Standing Stones, which made Sylvaine visibly uncomfortable.",0,'2025-01-22 18:20:00');
    mkEntry(s2,'c1',A,'She knows where they are. She didn\'t answer.',1,'2025-01-22 18:21:00');
    mkEntry(s2,'c1',A,'Encounter: Two Pale Hand scouts followed the party into the Ashwood. Sable detected them early. Party ambushed the ambush. One scout escaped. The other was captured briefly — revealed that the ritual "enters its second phase at the dark of the next moon."',0,'2025-01-22 18:45:00');
    mkEntry(s2,'c1',A,'Next dark moon is 12 days from now.',1,'2025-01-22 18:46:00');
    mkEntry(s2,'c1',A,'We need to move faster.',1,'2025-01-22 18:47:00');
    mkEntry(s2,'c1',A,'Retrieved provisions from the Covenant warehouse on the return journey. Brennan picked the lock in 40 seconds flat. The warding components were not there — moved recently.',0,'2025-01-22 19:00:00');
    mkEntry(s2,'c1',A,'Fresh scrape marks on the floor where crates were. Within the last three days.',1,'2025-01-22 19:01:00');

    const s3 = mkSession('c1', '2025-01-29 18:00:00');
    mkEntry(s3,'c1',A,'Session 3 — "The Undercroft Revelation" — Jan 29',0,'2025-01-29 18:00:00');
    mkEntry(s3,'c1',A,'Party entered the Undercroft via Mira\'s cellar connection. She introduced them to the Exchange — a tense scene. The Undercroft operators are not happy about Pale Hand tunnel incursions.',0,'2025-01-29 18:05:00');
    mkEntry(s3,'c1',A,'The operator — he called himself Cord — he\'s scared of the Hand but won\'t say it directly. Used phrases like "our guests who don\'t pay" and "the ones who don\'t clean up after themselves."',1,'2025-01-29 18:06:00');
    mkEntry(s3,'c1',A,'Made a deal with Cord: we clear the Hand out of the deep tunnels, he gives us access and information. He seemed relieved someone offered.',1,'2025-01-29 18:07:00');
    mkEntry(s3,'c1',A,'In the deep tunnels: discovered the extent of the Pale Hand operation. Ritual components, a partial binding circle diagram, and three cultists. Fight ensued. The cultists were not skilled combatants but they were fanatical.',0,'2025-01-29 18:30:00');
    mkEntry(s3,'c1',A,'One cultist surrendered. Major revelation: told the party that "the lord\'s coin" funds them. Implied Mourne. When pushed, confirmed it but added that Mourne thinks he controls the Hand. The cultist thinks this is funny.',0,'2025-01-29 18:45:00');
    mkEntry(s3,'c1',A,'He laughed when he said Mourne thinks he\'s in charge. That\'s not the laugh of someone who thinks their patron is powerful. That\'s the laugh of someone who thinks their patron is useful.',1,'2025-01-29 18:46:00');
    mkEntry(s3,'c1',A,'The binding circle diagram they left behind — it\'s incomplete but I can extrapolate. They need three anchor points: the Shard, a willing witness to the Watcher, and the Standing Stones. We\'ve complicated the first and third. The second...',1,'2025-01-29 18:50:00');
    mkEntry(s3,'c1',A,'Lira.',1,'2025-01-29 18:51:00');
    mkEntry(s3,'c1',A,'I said "a willing witness." None of us have volunteered.',1,'2025-01-29 18:52:00');
    mkEntry(s3,'c1',A,'I saw it.',1,'2025-01-29 18:53:00');
    mkEntry(s3,'c1',A,'You saw it. You didn\'t invite it. There\'s a ritual distinction. I\'ve been researching it.',1,'2025-01-29 18:54:00');
    mkEntry(s3,'c1',A,'Session ended with party back at the Gilded Anchor. 10 days until dark moon. Halveth sent a message via Boldwin — wants to meet privately.',0,'2025-01-29 19:00:00');

    // ── SESSION ATTENDANCE: CAMPAIGN 1 ──────────────────────────────────
    const partyAttendeeIds = [
      A,
      demoIds.demo_dm,
      demoIds.demo_player1,
      demoIds.demo_player2,
      demoIds.demo_player3,
    ];
    for (const uid of partyAttendeeIds) {
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s1, uid);
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s2, uid);
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s3, uid);
    }

    // ── SESSION PREP CHECKLIST: SESSION 4 PREP ───────────────────────────
    // Demonstrates the checklist feature; s4 is the upcoming session DM is prepping for
    const s4 = mkSession('c1', '2025-02-05 18:00:00');
    const checklistItems = [
      { content: 'Review Halveth\'s message — what does he know about Mourne?', checked: 1 },
      { content: 'Prepare Ironhold Keep guard patrol map for potential infiltration', checked: 1 },
      { content: 'Decide: does Mira tip off the Pale Hand before the party meets Halveth?', checked: 0 },
      { content: 'Prep the Watcher encounter in the cistern if party returns underground', checked: 0 },
      { content: 'Dark moon countdown — 10 days left, set up pressure at session start', checked: 0 },
      { content: 'Check if any player has noted the Shard\'s hum changing near Brennan', checked: 0 },
    ];
    checklistItems.forEach((item, i) => {
      db.prepare(`
        INSERT INTO session_checklist_items (session_id, content, is_checked, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(s4, item.content, item.checked, i + 1, A);
    });

    mkEntry(s4, 'c1', A, 'Session 4 — "Halveth\'s Gambit" — Feb 5', 0, '2025-02-05 18:00:00');
    mkEntry(s4, 'c1', A, 'Private meeting with Captain Halveth at the east dock safe house. He confirmed Mourne funds the Pale Hand but lacks proof the council would accept.', 0, '2025-02-05 18:10:00');
    mkEntry(s4, 'c1', A, 'Halveth will open the aqueduct route for one night if the party can move Sera to the Circle\'s Grove first.', 0, '2025-02-05 18:15:00');
    mkEntry(s4, 'c1', A, 'Sable spotted Griss-style surveillance on the docks — unrelated bounty work or Hand watchers?', 1, '2025-02-05 18:16:00');
    mkEntry(s4, 'c1', A, 'Party voted to prioritize the Shard retrieval before the dark moon. Lira requested time to compare the binding diagram with Sylvaine\'s maps.', 0, '2025-02-05 18:30:00');

    // Sample DM-only campaign folder tabs on Sunken Vale root.
    const dmFolderTabs = JSON.stringify([
      {
        id: 'demo-prep',
        title: 'Session prep',
        content: `## DM eyes only
Use tabs to organize clocks, fronts, and encounter math. Players only see the **party** column — these **DM** tabs are hidden from them.`,
      },
      {
        id: 'demo-secrets',
        title: 'Secrets',
        content: '- Veldrath may betray the party in Act II\n- The sunken vale holds an older god',
      },
    ]);
    db.prepare('UPDATE notes SET folder_dm_tabs = ?, folder_dm_content = NULL WHERE id = ?').run(dmFolderTabs, noteId.c1);

    applyDemoPermissions(A, demoIds);

    patchDemoNoteLinks();

    // Mark demo as seeded
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seeded', 'true')").run();
  });

  run();

  const demo_users = DEMO_USERNAMES.map((username) => ({
    username,
    password_hint,
    role: username === DEMO_OUTSIDER_USERNAME
      ? 'no world/campaign access (permission test)'
      : username === 'demo_dm'
        ? 'DM on world + Sunken Vale'
        : username === 'demo_player4'
          ? 'no access — not on world roster (invite to world first)'
          : username === 'demo_player3'
            ? 'partial note grants (missing Castor + Pale Hand)'
            : 'full party visibility',
  }));

  return { seeded: true, demo_users };
}

/**
 * Removes all demo-flagged notes and sessions. Does not delete real users.
 * folder_roles rows for deleted demo roots cascade with notes.
 * @returns {{ wiped: boolean }}
 */
function wipe() {
  const wipeRun = db.transaction(() => {
    db.prepare("DELETE FROM notes WHERE is_demo = 1").run();
    db.prepare("DELETE FROM sessions WHERE is_demo = 1").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seeded', 'false')").run();
  });
  wipeRun();
  cleanupDemoUserPersonalNotes();
  return { wiped: true };
}

module.exports = {
  seed,
  wipe,
  patchDemoNoteLinks,
  cleanupDemoUserPersonalNotes,
  ensureDemoUsers,
  DEMO_USERNAMES,
  DEMO_OUTSIDER_USERNAME,
  getDemoSeedPassword,
};
