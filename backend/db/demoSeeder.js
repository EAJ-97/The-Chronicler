'use strict';
const bcrypt = require('bcryptjs');
const db = require('./database');

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const noteId  = {};  // name → db id, populated as we insert
const userId  = {};  // username → db id

function mkUser(username, password, isAdmin = 0) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) { userId[username] = existing.id; return existing.id; }
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(
    "INSERT INTO users (username, password_hash, is_admin, is_demo) VALUES (?, ?, ?, 1)"
  ).run(username, hash, isAdmin);
  userId[username] = r.lastInsertRowid;
  return r.lastInsertRowid;
}

function mkFolder(title, owner, parentKey, extraFields = {}) {
  const parentId = parentKey ? noteId[parentKey] : null;
  const r = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, is_folder, is_shared, visibility, category, narrative_weight, is_demo)
    VALUES (?, ?, ?, 1, 1, 'shared', 'general', 'node', 1)
  `).run(userId[owner], parentId, title);
  return r.lastInsertRowid;
}

function mkNote(key, title, owner, parentKey, category, content, opts = {}) {
  const parentId = parentKey ? noteId[parentKey] : null;
  const r = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_folder, is_shared, visibility, category, significance, narrative_weight, is_demo)
    VALUES (?, ?, ?, ?, 0, 1, 'shared', ?, ?, ?, 1)
  `).run(
    userId[owner], parentId, title, content,
    category,
    opts.significance || 'standard',
    opts.weight || 'node'
  );
  noteId[key] = r.lastInsertRowid;
  if (opts.tags) {
    opts.tags.forEach(tag => {
      db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)").run(r.lastInsertRowid, tag);
    });
  }
  return r.lastInsertRowid;
}

function mkConn(keyA, keyB, label, createdBy) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO connections (source_note_id, target_note_id, label, created_by)
      VALUES (?, ?, ?, ?)
    `).run(noteId[keyA], noteId[keyB], label, userId[createdBy]);
  } catch(e) { /* dupe, skip */ }
}

function mkSession(folderKey, owner, ts) {
  const r = db.prepare(
    "INSERT INTO sessions (folder_id, created_at, is_demo) VALUES (?, ?, ?)"
  ).run(noteId[folderKey], ts, 1);
  return r.lastInsertRowid;
}

function mkEntry(sessionId, folderKey, author, content, indent = 0, ts) {
  const maxOrder = db.prepare("SELECT MAX(sort_order) as m FROM journal_entries").get().m || 0;
  db.prepare(`
    INSERT INTO journal_entries (user_id, folder_id, session_id, content, indent_level, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId[author], noteId[folderKey], sessionId, content, indent, maxOrder + 1, ts);
}

// ---------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------
function seed() {
  const already = db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get();
  if (already?.value === 'true') return { skipped: true };

  const run = db.transaction(() => {

    // ── USERS ──────────────────────────────────────────────────────────────
    mkUser('DungeonMaster', 'demo1234', 0);
    mkUser('Sable',         'demo1234');
    mkUser('Brennan',       'demo1234');
    mkUser('Lira',          'demo1234');
    mkUser('Theron',        'demo1234'); // ranger, tracker
    mkUser('Odalys',        'demo1234'); // cleric, healer
    mkUser('Vesper',        'demo1234'); // warlock, scholar
    mkUser('Cael',          'demo1234'); // fighter, sellsword

    // ── CAMPAIGN 1: THE SUNKEN VALE ────────────────────────────────────────
    noteId['c1'] = mkFolder('The Sunken Vale', 'DungeonMaster', null);
    // Assign DungeonMaster as DM of campaign 1
    db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId['c1'], userId['DungeonMaster']);

    // Sub-folders
    noteId['c1_npcs']      = mkFolder('NPCs',             'DungeonMaster', 'c1');
    noteId['c1_locs']      = mkFolder('Locations',        'DungeonMaster', 'c1');
    noteId['c1_factions']  = mkFolder('Factions',         'DungeonMaster', 'c1');
    noteId['c1_items']     = mkFolder('Items & Artifacts','DungeonMaster', 'c1');
    noteId['c1_quests']    = mkFolder('Quests & Events',  'DungeonMaster', 'c1');
    noteId['c1_lore']      = mkFolder('Lore & History',   'DungeonMaster', 'c1');
    noteId['c1_journal']   = mkFolder('Session Journal',  'DungeonMaster', 'c1');

    // ── NPCs ────────────────────────────────────────────────────────────────
    mkNote('castor', 'Lord Castor Mourne', 'DungeonMaster', 'c1_npcs', 'npc', `## Lord Castor Mourne
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

    mkNote('mira', 'Mira the Fence', 'Sable', 'c1_npcs', 'npc', `## Mira the Fence
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

    mkNote('halveth', 'Captain Dren Halveth', 'DungeonMaster', 'c1_npcs', 'npc', `## Captain Dren Halveth
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

    mkNote('sylvaine', 'Elder Sylvaine', 'Lira', 'c1_npcs', 'npc', `## Elder Sylvaine
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

    mkNote('breck', 'Thane Breck', 'Brennan', 'c1_npcs', 'npc', `## Thane Breck
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

    mkNote('pale_watcher', 'The Pale Watcher', 'DungeonMaster', 'c1_npcs', 'npc', `## The Pale Watcher
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

    mkNote('boldwin', 'Innkeeper Boldwin', 'Sable', 'c1_npcs', 'npc', `## Innkeeper Boldwin Cask
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
    mkNote('veldrath', 'Veldrath City', 'DungeonMaster', 'c1_locs', 'location', `## Veldrath
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

    mkNote('sunken_vale', 'The Sunken Vale', 'DungeonMaster', 'c1_locs', 'location', `## The Sunken Vale
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

    mkNote('ashwood', 'The Ashwood', 'Lira', 'c1_locs', 'location', `## The Ashwood
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

    mkNote('gilded_anchor', 'The Gilded Anchor', 'Sable', 'c1_locs', 'location', `## The Gilded Anchor
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

    mkNote('ironhold', 'Ironhold Keep', 'DungeonMaster', 'c1_locs', 'location', `## Ironhold Keep
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

    mkNote('undercroft', 'The Undercroft', 'Brennan', 'c1_locs', 'location', `## The Undercroft
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
    mkNote('iron_covenant', 'The Iron Covenant', 'DungeonMaster', 'c1_factions', 'faction', `## The Iron Covenant
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

    mkNote('circle_root', 'Circle of the Root', 'Lira', 'c1_factions', 'faction', `## Circle of the Root
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

    mkNote('pale_hand', 'The Pale Hand', 'DungeonMaster', 'c1_factions', 'faction', `## The Pale Hand
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
    mkNote('shard', 'The Shard of Echoes', 'DungeonMaster', 'c1_items', 'item', `## The Shard of Echoes
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

    mkNote('brecks_blade', "Breck's Masterwork", 'Brennan', 'c1_items', 'item', `## Breck's Masterwork Blade
*Item — Masterwork Longsword*

A longsword Breck forged as his journeyman piece 40 years ago — never sold, because he could never decide on a fair price for it. He has offered it to the party if Tolm is rescued.

### Properties
- Masterwork quality (+1 to attack rolls, non-magical)
- Unusually well-balanced — Breck says he "got lucky with the cooling"
- The crossguard is shaped like two clasped hands

### Current Status
Offered but not yet given. The rescue of Tolm is incomplete.
`, { significance: 'minor', weight: 'detail', tags: ['weapon', 'reward', 'breck'] }),

    mkNote('watcher_sigil', "The Pale Watcher's Sigil", 'DungeonMaster', 'c1_items', 'item', `## The Pale Watcher's Sigil
*Item — Cult Object, Dangerous*

A small disk of pale stone found on a Pale Hand cultist the party incapacitated in the Undercroft. Identical material to the Shard of Echoes. Carved with a symbol that Lira cannot fully look at directly.

### What's Known
- The cultist panicked when they saw the party had it
- It becomes cold when the Watcher is nearby
- Lira tried to sketch the symbol and found her hand shaking — the sketch doesn't match what she sees when she looks at the real thing

### DM Notes
It is a minor anchor point for the Watcher's presence. Destroying it will not harm the Watcher but will make it slightly less able to observe the party. They won't know this unless they experiment.
`, { significance: 'standard', weight: 'node', tags: ['cult object', 'pale hand', 'mysterious'] }),

    mkNote('scroll_unseal', 'Scroll of Unsealing', 'Lira', 'c1_items', 'item', `## Scroll of Unsealing
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
    mkNote('q_main', 'Find the Source of the Corruption', 'DungeonMaster', 'c1_quests', 'event', `## MAIN QUEST: Find the Source of the Corruption
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

    mkNote('q_shipments', 'The Missing Shipments', 'Brennan', 'c1_quests', 'event', `## SIDE QUEST: The Missing Shipments
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

    mkNote('q_tolm', "Breck's Debt & Tolm", 'Brennan', 'c1_quests', 'event', `## SIDE QUEST: Free Tolm from the Covenant
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
    mkNote('lore_vale', "The Vale's Ancient History", 'Lira', 'c1_lore', 'lore', `## The Ancient History of the Vale
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

    mkNote('lore_old_gods', 'The Old Gods of the Ashwood', 'Lira', 'c1_lore', 'lore', `## The Old Gods of the Ashwood
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

    mkNote('lore_covenant', "The Covenant's True Purpose", 'DungeonMaster', 'c1_lore', 'lore', `## The Iron Covenant's True Purpose
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
`, { significance: 'major', weight: 'node', tags: ['lore', 'iron covenant', 'dm only'] }),

    // ── CAMPAIGN 2: WHISPERS OF THE ASHBORN ───────────────────────────────
    noteId['c2'] = mkFolder('Whispers of the Ashborn', 'DungeonMaster', null);
    // Assign DungeonMaster as DM of campaign 2
    db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(noteId['c2'], userId['DungeonMaster']);
    noteId['c2_npcs']    = mkFolder('NPCs',           'DungeonMaster', 'c2');
    noteId['c2_locs']    = mkFolder('Locations',      'DungeonMaster', 'c2');
    noteId['c2_quests']  = mkFolder('Quests',         'DungeonMaster', 'c2');
    noteId['c2_journal'] = mkFolder('Session Journal','DungeonMaster', 'c2');

    mkNote('c2_zara', 'Zara of the Ashborn', 'DungeonMaster', 'c2_npcs', 'npc', `## Zara of the Ashborn
*Protagonist — Tiefling, 24*

Former member of a nomadic clan that was scattered by an imperial conscription raid. She is searching for surviving clan members and increasingly suspicious that the "accident" was not an accident.

### Party Role
This is the one-shot campaign's main contact. The party has been hired to escort her to the Borderlands, where the last known survivor — her younger brother Renn — was reportedly seen.

### Her Abilities
Knows the Old Roads by memory. Has minor divination magic she calls "reading the ash" — inherited from her grandmother.

### The Complication
Renn may not be the person she remembers. Reports suggest he has joined the Ironsworn, the same military force that destroyed their clan.
`, { significance: 'major', weight: 'landmark', tags: ['npc', 'tiefling', 'main contact'] }),

    mkNote('c2_borderlands', 'The Borderlands', 'DungeonMaster', 'c2_locs', 'location', `## The Borderlands
*Region — Frontier Territory*

A contested region between the Empire and the Free Cities. No single authority governs it. The Ashborn nomads have lived here for generations precisely because nobody else wanted it.

### Current State
The Ironsworn have established three outposts. Technically they claim it's for "protection of trade routes." The nomadic clans that remain say it's occupation with better branding.

### Travel Notes
- The Old Roads are faster but increasingly patrolled
- The Ashroads (Zara's route) are slower but almost invisible to outsiders
- Weather turns hard fast in the plateau sections — be prepared
`, { significance: 'standard', weight: 'node', tags: ['location', 'borderlands', 'frontier'] }),

    mkNote('c2_renn', 'Renn (Zara\'s Brother)', 'DungeonMaster', 'c2_npcs', 'npc', `## Renn
*Complex NPC — Tiefling, 19*

Zara's younger brother. Currently a probationary soldier in the Ironsworn 3rd Company. He was not conscripted — he enlisted willingly, two months after the clan was scattered.

### The Question
Does he know what the Ironsworn did? Does he know it wasn't an accident? Did he join because he was scared and it was safety — or because something else is going on?

### DM Answer
He knows. He joined because an Ironsworn officer promised him information about which clan members survived in exchange for service. He has been paying that price for eight months. He is not okay.

### The Meeting
Will be difficult. He does not want to be found by Zara specifically — he's ashamed. The party will need to decide whether to bring him home or respect that he's made a different choice.
`, { significance: 'major', weight: 'node', tags: ['npc', 'tiefling', 'family'] }),

    mkNote('c2_q1', 'Find Renn', 'DungeonMaster', 'c2_quests', 'event', `## QUEST: Find Renn
*Status: Active — Session 1*

Escort Zara from the Free City of Maren to the Borderlands and locate her brother Renn, last reported near Ironsworn Outpost 3.

### Complications
- The Old Roads are watched
- Zara doesn't know Renn joined the Ironsworn willingly
- A bounty hunter named Griss has been following Zara — unknown who hired him

### Session 1 Progress
- Party met Zara at the Salt Market in Maren
- Griss made contact and backed off when Brennan called his bluff
- Currently two days travel from the Borderlands on the Ashroads
`, { significance: 'major', weight: 'landmark', tags: ['main quest', 'escort', 'family'] }),

    // ── CONNECTIONS ─────────────────────────────────────────────────────────
    mkConn('castor',       'iron_covenant',  'financed by',       'DungeonMaster');
    mkConn('castor',       'pale_hand',      'secret financier',  'DungeonMaster');
    mkConn('castor',       'halveth',        'commands',          'DungeonMaster');
    mkConn('castor',       'ironhold',       'resides in',        'DungeonMaster');
    mkConn('pale_watcher', 'pale_hand',      'entity behind',     'DungeonMaster');
    mkConn('pale_watcher', 'shard',          'bound to',          'DungeonMaster');
    mkConn('pale_hand',    'undercroft',     'operates through',  'DungeonMaster');
    mkConn('pale_hand',    'sunken_vale',    'conducting ritual', 'DungeonMaster');
    mkConn('iron_covenant','pale_hand',      'secretly funding',  'DungeonMaster');
    mkConn('iron_covenant','breck',          'holds debt over',   'DungeonMaster');
    mkConn('mira',         'undercroft',     'operates from',     'Sable');
    mkConn('mira',         'gilded_anchor',  'based at',          'Sable');
    mkConn('halveth',      'ironhold',       'commands guard at', 'DungeonMaster');
    mkConn('sylvaine',     'circle_root',    'leads',             'Lira');
    mkConn('sylvaine',     'ashwood',        'protects',          'Lira');
    mkConn('circle_root',  'ashwood',        'maintains',         'Lira');
    mkConn('breck',        'ironhold',       'built tunnels under','Brennan');
    mkConn('shard',        'sunken_vale',    'sealed within',     'DungeonMaster');
    mkConn('shard',        'watcher_sigil',  'same material',     'Lira');
    mkConn('q_main',       'sunken_vale',    'centered on',       'DungeonMaster');
    mkConn('q_main',       'pale_hand',      'blocked by',        'DungeonMaster');
    mkConn('q_tolm',       'breck',          'concerns',          'Brennan');
    mkConn('q_shipments',  'circle_root',    'affected',          'Brennan');
    mkConn('lore_vale',    'sunken_vale',    'documents',         'Lira');
    mkConn('lore_old_gods','ashwood',        'describes',         'Lira');
    mkConn('veldrath',     'gilded_anchor',  'contains',          'Sable');
    mkConn('veldrath',     'ironhold',       'dominated by',      'DungeonMaster');
    mkConn('veldrath',     'undercroft',     'underlies',         'Brennan');
    mkConn('boldwin',      'gilded_anchor',  'owns',              'Sable');
    mkConn('c2_zara',      'c2_renn',        'searching for',     'DungeonMaster');
    mkConn('c2_zara',      'c2_borderlands', 'traveling to',      'DungeonMaster');
    mkConn('c2_renn',      'c2_q1',          'subject of',        'DungeonMaster');

    // ── JOURNAL: CAMPAIGN 1 ──────────────────────────────────────────────
    const s1 = mkSession('c1', 'DungeonMaster', '2025-01-15 18:00:00');
    mkEntry(s1,'c1','DungeonMaster','Session 1 — "The Gilded Anchor" — Jan 15',0,'2025-01-15 18:00:00');
    mkEntry(s1,'c1','DungeonMaster',"Party arrived in Veldrath by merchant ship. Sable immediately cased the docks. Brennan got in an argument with a dockworker that nearly became a fight.",0,'2025-01-15 18:05:00');
    mkEntry(s1,'c1','Sable','That dockworker was definitely watching us.',1,'2025-01-15 18:06:00');
    mkEntry(s1,'c1','Brennan',"He was just annoyed I bumped his cart. Probably.",1,'2025-01-15 18:07:00');
    mkEntry(s1,'c1','DungeonMaster','Checked into the Gilded Anchor. Boldwin gave them rooms 4, 7, and 9. Lira immediately went to the library, was back by nightfall with notes on the Sunken Vale.',0,'2025-01-15 18:15:00');
    mkEntry(s1,'c1','Lira',"The librarian was unhelpful but the archive wasn't locked. Found three references to pre-Founding structures in the valley. The Veldrath city records actively avoid mentioning them.",1,'2025-01-15 18:16:00');
    mkEntry(s1,'c1','Lira','Cross-reference: the phrase "the gate must not be fed" appears in two separate documents, neither of which cites the other. Predates city record keeping.',2,'2025-01-15 18:17:00');
    mkEntry(s1,'c1','DungeonMaster','Evening: Party met Mira in the Gilded Anchor cellar. She had been warned they were coming (by whom she declined to say). Sold them the basic intelligence package — Mourne, Halveth, the Covenant\'s interests.',0,'2025-01-15 18:30:00');
    mkEntry(s1,'c1','Sable','She knows more than she\'s selling. Watch her hands when she talks about the Pale Hand — she\'s careful.',1,'2025-01-15 18:31:00');
    mkEntry(s1,'c1','DungeonMaster',"Late night: Brennan saw the figure at his window. White. Still. Gone when he blinked. Party spent an uncomfortable hour discussing what it was. No consensus. Lira wrote down the description.",0,'2025-01-15 19:00:00');
    mkEntry(s1,'c1','Brennan',"I know what I saw.",1,'2025-01-15 19:01:00');
    mkEntry(s1,'c1','Lira','Noted.',1,'2025-01-15 19:02:00');

    const s2 = mkSession('c1', 'DungeonMaster', '2025-01-22 18:00:00');
    mkEntry(s2,'c1','DungeonMaster','Session 2 — "Into the Ashwood" — Jan 22',0,'2025-01-22 18:00:00');
    mkEntry(s2,'c1','DungeonMaster',"Traveled north to meet Elder Sylvaine. The forest felt wrong from the first mile in — too quiet, then briefly too loud in the wrong ways. No birds after the first hour.",0,'2025-01-22 18:05:00');
    mkEntry(s2,'c1','Lira','The trees on the north edge have moved. I paced off the old path against the survey map Sylvaine gave me. 11 feet of deviation over approximately 200 yards. Whatever is moving them is doing it slowly and consistently.',1,'2025-01-22 18:06:00');
    mkEntry(s2,'c1','Sable',"Lira, how long has that been happening?",1,'2025-01-22 18:07:00');
    mkEntry(s2,'c1','Lira',"Based on the rate? At least 8 months. Before any of the other incidents.",1,'2025-01-22 18:08:00');
    mkEntry(s2,'c1','DungeonMaster',"Met Sylvaine at the Circle's Grove. She was expecting them. Session included a long roleplay exchange — Sylvaine gave significant lore about the First Quieting. Lira asked most of the right questions. Brennan asked about the Standing Stones, which made Sylvaine visibly uncomfortable.",0,'2025-01-22 18:20:00');
    mkEntry(s2,'c1','Brennan','She knows where they are. She didn\'t answer.',1,'2025-01-22 18:21:00');
    mkEntry(s2,'c1','DungeonMaster','Encounter: Two Pale Hand scouts followed the party into the Ashwood. Sable detected them early. Party ambushed the ambush. One scout escaped. The other was captured briefly — revealed that the ritual "enters its second phase at the dark of the next moon."',0,'2025-01-22 18:45:00');
    mkEntry(s2,'c1','Sable','Next dark moon is 12 days from now.',1,'2025-01-22 18:46:00');
    mkEntry(s2,'c1','Sable','We need to move faster.',1,'2025-01-22 18:47:00');
    mkEntry(s2,'c1','DungeonMaster','Retrieved provisions from the Covenant warehouse on the return journey. Brennan picked the lock in 40 seconds flat. The warding components were not there — moved recently.',0,'2025-01-22 19:00:00');
    mkEntry(s2,'c1','Brennan','Fresh scrape marks on the floor where crates were. Within the last three days.',1,'2025-01-22 19:01:00');

    const s3 = mkSession('c1', 'DungeonMaster', '2025-01-29 18:00:00');
    mkEntry(s3,'c1','DungeonMaster','Session 3 — "The Undercroft Revelation" — Jan 29',0,'2025-01-29 18:00:00');
    mkEntry(s3,'c1','DungeonMaster','Party entered the Undercroft via Mira\'s cellar connection. She introduced them to the Exchange — a tense scene. The Undercroft operators are not happy about Pale Hand tunnel incursions.',0,'2025-01-29 18:05:00');
    mkEntry(s3,'c1','Sable','The operator — he called himself Cord — he\'s scared of the Hand but won\'t say it directly. Used phrases like "our guests who don\'t pay" and "the ones who don\'t clean up after themselves."',1,'2025-01-29 18:06:00');
    mkEntry(s3,'c1','Brennan','Made a deal with Cord: we clear the Hand out of the deep tunnels, he gives us access and information. He seemed relieved someone offered.',1,'2025-01-29 18:07:00');
    mkEntry(s3,'c1','DungeonMaster','In the deep tunnels: discovered the extent of the Pale Hand operation. Ritual components, a partial binding circle diagram, and three cultists. Fight ensued. The cultists were not skilled combatants but they were fanatical.',0,'2025-01-29 18:30:00');
    mkEntry(s3,'c1','DungeonMaster','One cultist surrendered. Major revelation: told the party that "the lord\'s coin" funds them. Implied Mourne. When pushed, confirmed it but added that Mourne thinks he controls the Hand. The cultist thinks this is funny.',0,'2025-01-29 18:45:00');
    mkEntry(s3,'c1','Sable','He laughed when he said Mourne thinks he\'s in charge. That\'s not the laugh of someone who thinks their patron is powerful. That\'s the laugh of someone who thinks their patron is useful.',1,'2025-01-29 18:46:00');
    mkEntry(s3,'c1','Lira','The binding circle diagram they left behind — it\'s incomplete but I can extrapolate. They need three anchor points: the Shard, a willing witness to the Watcher, and the Standing Stones. We\'ve complicated the first and third. The second...',1,'2025-01-29 18:50:00');
    mkEntry(s3,'c1','Brennan','Lira.',1,'2025-01-29 18:51:00');
    mkEntry(s3,'c1','Lira','I said "a willing witness." None of us have volunteered.',1,'2025-01-29 18:52:00');
    mkEntry(s3,'c1','Brennan','I saw it.',1,'2025-01-29 18:53:00');
    mkEntry(s3,'c1','Lira','You saw it. You didn\'t invite it. There\'s a ritual distinction. I\'ve been researching it.',1,'2025-01-29 18:54:00');
    mkEntry(s3,'c1','DungeonMaster','Session ended with party back at the Gilded Anchor. 10 days until dark moon. Halveth sent a message via Boldwin — wants to meet privately.',0,'2025-01-29 19:00:00');

    // ── SESSION ATTENDANCE: CAMPAIGN 1 ──────────────────────────────────
    // Records which players attended each session (Phase 1 roadmap feature pre-scaffold)
    const attendees = ['Sable', 'Brennan', 'Lira'];
    for (const name of attendees) {
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s1, userId[name]);
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s2, userId[name]);
      db.prepare("INSERT OR IGNORE INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, 1)").run(s3, userId[name]);
    }

    // ── SESSION PREP CHECKLIST: SESSION 4 PREP ───────────────────────────
    // Demonstrates the checklist feature; s4 is the upcoming session DM is prepping for
    const s4 = mkSession('c1', 'DungeonMaster', '2025-02-05 18:00:00');
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
      `).run(s4, item.content, item.checked, i + 1, userId['DungeonMaster']);
    });

    // ── JOURNAL: CAMPAIGN 2 ──────────────────────────────────────────────
    const cs1 = mkSession('c2', 'DungeonMaster', '2025-02-05 18:00:00');
    mkEntry(cs1,'c2','DungeonMaster','Session 1 — "Salt Market" — Feb 5',0,'2025-02-05 18:00:00');
    mkEntry(cs1,'c2','DungeonMaster','Party hired at the Salt Market in Maren. The job: escort Zara to the Borderlands. She was vague about why she needed protection specifically. Sable noticed the bounty hunter Griss watching from across the square.',0,'2025-02-05 18:05:00');
    mkEntry(cs1,'c2','Sable','Griss is Thornfield Guild. Mid-range contract work. Whoever hired him didn\'t want to spend much, or they wanted deniability.',1,'2025-02-05 18:06:00');
    mkEntry(cs1,'c2','DungeonMaster','Brennan confronted Griss directly. Griss backed down when he realized the party was more prepared than his briefing suggested. He left the market. Zara thanked Brennan with visible relief.',0,'2025-02-05 18:20:00');
    mkEntry(cs1,'c2','Brennan','He\'ll be back. People like Griss don\'t give up the contract, they just reassess the approach.',1,'2025-02-05 18:21:00');
    mkEntry(cs1,'c2','DungeonMaster','Departed Maren on the Ashroads. Zara knows these paths intuitively — she barely has to think about direction. She was quieter as they got further from the city.',0,'2025-02-05 18:35:00');
    mkEntry(cs1,'c2','Lira','She\'s reading the ash — literally. She stops occasionally and stirs a small patch of soil or ash with her fingers, then adjusts course slightly. I asked her about it. She said her grandmother called it listening to where the land has been.',1,'2025-02-05 18:36:00');
    mkEntry(cs1,'c2','DungeonMaster','Session ended camped in the foothills, one day from the Borderlands. Zara spoke more about Renn in the evening — before the raid, he was studying to be a mapmaker. She carried one of his unfinished maps.',0,'2025-02-05 19:00:00');

    // Mark demo as seeded
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seeded', 'true')").run();
  });

  run();
  return { seeded: true };
}

function wipe() {
  const wipeRun = db.transaction(() => {
    // Delete demo users — cascades to their journal entries
    const demoUsers = db.prepare("SELECT id FROM users WHERE is_demo = 1").all();
    demoUsers.forEach(u => db.prepare("DELETE FROM users WHERE id = ?").run(u.id));

    // Delete demo notes — cascades to connections, tags, sessions, journal entries via folder_id
    db.prepare("DELETE FROM notes WHERE is_demo = 1").run();

    // Clean up any orphaned sessions
    db.prepare("DELETE FROM sessions WHERE is_demo = 1").run();

    // Reset seeded flag
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seeded', 'false')").run();
  });
  wipeRun();
  return { wiped: true };
}

module.exports = { seed, wipe };
