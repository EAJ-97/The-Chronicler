const db = require('../db/database');

/**
 * Seeds a starter campaign and personal notes for the first admin user on register.
 * All campaign notes use visibility='shared' so they appear to party members.
 * All notes are flagged is_demo=1 for future cleanup if needed.
 * The admin is assigned as DM of their own campaign via folder_roles.
 * @param {number} userId - The admin user's database id
 */
function seedDemoForAdmin(userId) {
  const createNote = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const createConn = db.prepare(`
    INSERT OR IGNORE INTO connections (source_note_id, target_note_id, label, created_by)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    // Campaign root — shared so all party members can see it
    const campaign = createNote.run(userId, null, 'The Shattered Crown', '', 1, 1, 'general', 0, 'shared');
    const cId = campaign.lastInsertRowid;

    // Assign admin as DM of their own campaign
    db.prepare("INSERT OR IGNORE INTO folder_roles (folder_id, user_id, role) VALUES (?, ?, 'dm')").run(cId, userId);

    const characters = createNote.run(userId, cId, 'Characters', '', 1, 1, 'general', 0, 'shared');
    const locations  = createNote.run(userId, cId, 'Locations',  '', 1, 1, 'general', 1, 'shared');
    const factions   = createNote.run(userId, cId, 'Factions',   '', 1, 1, 'general', 2, 'shared');
    const quests     = createNote.run(userId, cId, 'Quests',     '', 1, 1, 'general', 3, 'shared');

    const mira = createNote.run(userId, characters.lastInsertRowid, 'Mira Ashveil',
      '## Mira Ashveil\n*Human Rogue, Faction Contact*\n\n**First met:** The Rusty Flagon tavern, Session 1\n\n### Appearance\nTall, sharp-featured woman in her mid-thirties. Always wears a deep crimson cloak.\n\n### Known Information\n- Intermediary for the **Crimson Accord**\n- Claims to want peace between the factions\n- Hinted she knows where the first Crown Shard is hidden\n\n> She is playing both sides. The party does not know yet.',
      1, 0, 'npc', 0, 'shared');

    const varen = createNote.run(userId, characters.lastInsertRowid, 'Lord Varen Thex',
      '## Lord Varen Thex\n*Human Warlock, Antagonist*\n\n**Status:** Unknown location\n\n### Appearance\nGaunt nobleman, silver hair, eyes that catch the light wrong.\n\n### Known Information\n- Former member of the royal council\n- Disappeared 3 years ago after the Shattering\n- Believed to be hunting the Crown Shards',
      1, 0, 'npc', 1, 'shared');

    const ironhaven = createNote.run(userId, locations.lastInsertRowid, 'Ironhaven City',
      '## Ironhaven City\n*Major Settlement, Northern Region*\n\n**Population:** ~12,000\n\n### Points of Interest\n- **The Rusty Flagon** — party home base\n- **The Iron Exchange** — merchant guild, front for the Accord\n- **Old Quarter** — ruins from before the Shattering',
      1, 0, 'location', 0, 'shared');

    const vault = createNote.run(userId, locations.lastInsertRowid, 'The Sunken Vault',
      '## The Sunken Vault\n*Dungeon Location — Unexplored*\n\n### Description\nAn ancient treasury that sank into the earth during the Shattering. Local legends say it holds a **Crown Shard**.\n\n### Known Hazards\n- Flooded lower levels\n- Undead guardians\n- Unstable stonework',
      1, 0, 'location', 1, 'shared');

    const accord = createNote.run(userId, factions.lastInsertRowid, 'The Crimson Accord',
      '## The Crimson Accord\n*Faction — Neutral (Suspected)*\n\n**Base:** Ironhaven City\n\n### Goals\nPublicly: restore stability to the kingdom.\nActually: unknown.\n\n### Party Relationship\nCautious alliance. Paid us once. Do not fully trust them.',
      1, 0, 'faction', 0, 'shared');

    const questNote = createNote.run(userId, quests.lastInsertRowid, 'Retrieve the Crown Shard',
      '## Retrieve the Crown Shard\n*Active Quest*\n\n**Reward:** 500gp + faction standing\n\n### Progress\n- [x] Received quest from Mira\n- [x] Found partial map to the Vault\n- [ ] Enter the Sunken Vault\n- [ ] Locate the Shard\n- [ ] Decide who to give it to',
      1, 0, 'event', 0, 'shared');

    // Personal notes — private to the admin
    const personal = createNote.run(userId, null, 'My Notes', '', 0, 1, 'general', 1, 'private');
    createNote.run(userId, personal.lastInsertRowid, 'Session Log',
      '# Session Log\n\n## Session 1\nParty met at the Rusty Flagon. Mira approached us with the quest.\n\n## Session 2\nFound the partial map in the Old Quarter ruins. Spotted suspicious figures.',
      0, 0, 'general', 0, 'private');

    // Connections
    createConn.run(mira.lastInsertRowid,   accord.lastInsertRowid,    'member of',   userId);
    createConn.run(varen.lastInsertRowid,  ironhaven.lastInsertRowid, 'controls',    userId);
    createConn.run(vault.lastInsertRowid,  questNote.lastInsertRowid, 'location of', userId);
    createConn.run(varen.lastInsertRowid,  questNote.lastInsertRowid, 'antagonist',  userId);
    createConn.run(mira.lastInsertRowid,   questNote.lastInsertRowid, 'quest giver', userId);
    createConn.run(accord.lastInsertRowid, ironhaven.lastInsertRowid, 'operates in', userId);
  })();
}

/**
 * Seeds a personal notes folder with a welcome note for every non-admin user on register.
 * Notes are private by default.
 * @param {number} userId - The new user's database id
 */
function seedDemoForUser(userId) {
  const createNote = db.prepare(`
    INSERT INTO notes (user_id, parent_id, title, content, is_shared, is_folder, category, sort_order, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    const personal = createNote.run(userId, null, 'My Notes', '', 0, 1, 'general', 0, 'private');
    createNote.run(userId, personal.lastInsertRowid, 'Welcome',
      '# Welcome to The Chronicler!\n\nThis is your personal space. Shared campaign notes appear alongside these.\n\n## Getting Started\n- Create folders to organise your notes\n- Use the **Web** view to see how notes connect\n- Link notes at the bottom of each note editor\n- Toggle **Party Shared** to let your whole party see a note',
      0, 0, 'general', 0, 'private');
  })();
}

module.exports = { seedDemoForAdmin, seedDemoForUser };
