/**
 * Tutorial step builder.
 *
 * Each step describes what to spotlight and what UI state to force while it is active.
 * Dashboard owns orchestration (open Admin panel, set view, select Sunken Vale, etc.).
 *
 * @typedef {'normal'|'danger'} HighlightVariant
 *
 * @typedef {Object} TutorialStep
 * @property {string} id - Stable identifier for analytics/debugging
 * @property {string} chapterId - Groups steps into a chapter (used by chapter picker)
 * @property {string} chapter - Human chapter label shown in the card
 * @property {string} [subsection] - Optional smaller label under the chapter (e.g. "Icons")
 * @property {string} title - Step title
 * @property {string} body - Step body copy
 * @property {string} target - Key into Dashboard-provided targetRefs
 * @property {HighlightVariant} [highlightVariant] - Visual emphasis for dangerous actions
 * @property {Object} [ui]
 * @property {'admin'|'notes'|'graph'|'journal'} [ui.view] - Main dashboard view to show
 * @property {boolean} [ui.openAdmin] - Open/close Admin panel while step is active
 * @property {'users'|'vault'|'demo'|'ai'|'backup'|'password'} [ui.adminTab] - Admin panel tab
 * @property {boolean} [ui.selectSunkenVale] - Select Sunken Vale demo root in the sidebar/editor
 * @property {boolean} [ui.clearSelection] - Clear selected note/folder (shows global create actions in Vault)
 * @property {string} [ui.noteEditorRootToolsTab] - 'icons'|'ai'|'continuity'
 * @property {string} [ui.noteEditorDrawerTab] - 'connections'|'tags'|'images'
 * @property {boolean} [ui.ensureDrawerOpen] - Ensure bottom drawer is expanded
 * @property {boolean} [ui.ensureDrawerClosed] - Ensure bottom drawer is collapsed
 * @property {boolean} [ui.ensureRootToolsVisible] - Ensure root tools tab bar is visible (best-effort)
 * @property {boolean} [ui.forceShowBackupActions] - Force sidebar root action buttons visible for Sunken Vale
 */

/**
 * Builds the tutorial steps and chapter list, applying demo/admin gating rules.
 * @param {{ isAdmin: boolean, demoSeeded: boolean }} ctx
 * @returns {{ steps: TutorialStep[], chapters: { id: string, label: string }[] }}
 */
export function buildTutorialSteps({ isAdmin, demoSeeded }) {
  /** @type {TutorialStep[]} */
  let steps = [];

  // Demo not generated: gate behavior (per requirement).
  if (!demoSeeded) {
    if (isAdmin) {
      steps.push({
        id: 'gate_admin_demo_needed',
        chapterId: 'admin',
        chapter: 'Admin',
        subsection: 'Demo required',
        title: 'Generate demo for full tutorial',
        target: 'tutorialCard',
        body:
          'To run the full tutorial, generate demo data first (Admin → DEMO → Generate). ' +
          'If you skip this, you can still tour the Admin Panel, but the demo-driven chapters (Notes/Web/Journal/Backups) will be unavailable.',
        ui: { view: 'admin', openAdmin: true, adminTab: 'demo' },
      });

      // Admin chapter only
      steps = steps.concat(buildAdminChapterSteps());
    } else {
      steps.push({
        id: 'gate_user_demo_missing',
        chapterId: 'users',
        chapter: 'Users',
        subsection: 'Demo missing',
        title: 'Ask your admin to generate demo',
        target: 'tutorialCard',
        body:
          'This server has not generated demo content yet, so the guided tutorial is not available. ' +
          'Ask an admin to generate demo data from the Admin Panel, then reopen Tutorial.',
      });
    }

    return { steps, chapters: buildChaptersFromSteps(steps) };
  }

  // Full tutorial (demo is seeded)
  if (isAdmin) steps = steps.concat(buildAdminChapterSteps());

  steps = steps.concat(buildVaultChapterSteps());
  steps = steps.concat(buildNotesChapterSteps());
  steps = steps.concat(buildWebChapterSteps());
  steps = steps.concat(buildJournalChapterSteps());
  steps = steps.concat(buildBackupsChapterSteps());

  if (!isAdmin) steps = steps.concat(buildUsersChapterSteps());

  return { steps, chapters: buildChaptersFromSteps(steps) };
}

function buildAdminChapterSteps() {
  /** @type {TutorialStep[]} */
  const out = [];
  out.push({
    id: 'admin_intro',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'Overview',
    title: 'Admin Panel',
    target: 'adminPanelShell',
    body: 'Admins manage party accounts, snapshots, demo generation, AI keys, backups, and password recovery tools here.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'users' },
  });
  out.push({
    id: 'admin_party',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'PARTY',
    title: 'Party (users & registration)',
    target: 'adminTab_users',
    body: 'Create users, set passwords, and open/close registration for your server.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'users' },
  });
  out.push({
    id: 'admin_vault',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'VAULT',
    title: 'Vault (snapshots)',
    target: 'adminTab_vault',
    body: 'Browse snapshots and restore a campaign state when something goes wrong.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'vault' },
  });
  out.push({
    id: 'admin_demo',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'DEMO',
    title: 'Demo (shared showcase)',
    target: 'adminTab_demo',
    body: 'Generate or wipe the shared demo campaigns. Everyone can view them; only admins can edit demo content.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'demo' },
  });
  out.push({
    id: 'admin_ai',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'AI',
    title: 'AI (Anthropic key & toggle)',
    target: 'adminTab_ai',
    body: 'Configure the Anthropic key and enable AI for recaps and DM tools.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'ai' },
  });
  out.push({
    id: 'admin_backup',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'BACKUP',
    title: 'Backup (DB + import)',
    target: 'adminTab_backup',
    body: 'Download a full database backup and import a Chronicler JSON export when needed.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'backup' },
  });
  out.push({
    id: 'admin_pwd',
    chapterId: 'admin',
    chapter: 'Admin',
    subsection: 'PWD',
    title: 'Password (admin self-service)',
    target: 'adminTab_password',
    body: 'Change your own password and manage password reset flows safely.',
    ui: { view: 'admin', openAdmin: true, adminTab: 'password' },
  });
  return out;
}

function buildVaultChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'vault_sidebar_browse',
      chapterId: 'vault',
      chapter: 'Vault',
      subsection: 'Browse',
      title: 'Worlds and campaigns',
      target: 'sidebar',
      body: 'Browse worlds and campaigns inside those worlds, or create standalone campaigns at the top level.',
      ui: { view: 'notes', openAdmin: false },
    },
    {
      id: 'vault_create_buttons',
      chapterId: 'vault',
      chapter: 'Vault',
      subsection: 'Create',
      title: 'Create buttons',
      target: 'noteListCreateBar',
      body:
        'Use + Note to create a note near your current selection. ' +
        '+ World creates a world root. + Campaign creates a standalone campaign (or a campaign inside a selected world).',
      ui: { view: 'notes', openAdmin: false, clearSelection: true },
    },
  ];
}

function buildNotesChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'notes_root_select',
      chapterId: 'notes',
      chapter: 'Notes',
      subsection: 'Sunken Vale',
      title: 'Open the demo campaign',
      target: 'sidebar',
      body: 'Select the demo campaign root “The Sunken Vale”. You’ll see DM surfaces like AI tools, while demo data remains read-only unless you are an admin.',
      ui: { view: 'notes', selectSunkenVale: true, openAdmin: false },
    },
    {
      id: 'notes_dm_tabs',
      chapterId: 'notes',
      chapter: 'Notes',
      subsection: 'DM tabs',
      title: 'Icons, AI tools, Continuity',
      target: 'noteEditorRootToolsTabs',
      body: 'On world/campaign roots you get the DM tool tabs: Icons (appearance), AI tools (generators), and Continuity (campaign consistency report).',
      ui: { view: 'notes', selectSunkenVale: true, ensureRootToolsVisible: true, noteEditorRootToolsTab: 'icons' },
    },
    {
      id: 'notes_sidebar_description',
      chapterId: 'notes',
      chapter: 'Notes',
      subsection: 'Sidebar description',
      title: 'Describe the campaign',
      target: 'noteEditorSidebarDescription',
      body: 'This short description appears in sidebar tooltips and helps players understand the campaign at a glance.',
      ui: { view: 'notes', selectSunkenVale: true },
    },
    {
      id: 'notes_split_view',
      chapterId: 'notes',
      chapter: 'Notes',
      subsection: 'Player vs DM',
      title: 'Two halves: party + DM',
      target: 'noteEditorCampaignSplit',
      body: 'Campaign roots can show party-visible content alongside DM-only notes. In demo mode, everyone can view DM surfaces, but only admins may modify demo content.',
      ui: { view: 'notes', selectSunkenVale: true, ensureDrawerClosed: true },
    },
    {
      id: 'notes_bottom_drawer',
      chapterId: 'notes',
      chapter: 'Notes',
      subsection: 'Bottom drawer',
      title: 'Connections, tags, images',
      target: 'noteEditorDrawerExpand',
      body: 'Open the bottom drawer to manage connections, tags, and images for the selected note. There is also a Party/Access option here when permitted.',
      ui: { view: 'notes', selectSunkenVale: true, ensureDrawerOpen: true, noteEditorDrawerTab: 'connections' },
    },
  ];
}

function buildWebChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'web_intro',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Overview',
      title: 'Knowledge graph',
      target: 'graphCanvas',
      body: 'The Web view visualizes note connections in the active campaign.',
      ui: { view: 'graph', selectSunkenVale: true, graphForce2D: true },
    },
    {
      id: 'web_campaign_select',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Campaign',
      title: 'Campaign selection',
      target: 'graphCampaignSelect',
      body: 'Choose which campaign’s graph to display.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_connect',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Connect',
      title: 'Connect mode',
      target: 'graphBtn_connect',
      body: 'Connect mode creates a canonical (orange) link between two notes by clicking a source then a target.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_find_path',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Find path',
      title: 'Find Path',
      target: 'graphBtn_path',
      body: 'Find Path highlights the shortest canonical path between two notes.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_theory',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Theory',
      title: 'Theory links',
      target: 'graphBtn_theory',
      body: 'Theory links are speculative (violet) and do not affect canonical pathfinding tiers.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_ship',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Ship',
      title: 'Ship links',
      target: 'graphBtn_ship',
      body: 'Ship links are playful (pink) links between NPC/Character notes.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_3d',
      chapterId: 'web',
      chapter: 'Web',
      subsection: '3D',
      title: '2D / 3D toggle',
      target: 'graphBtn_3d',
      body: 'Switch between 2D and 3D graph layouts.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_expand',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Layout',
      title: 'Layout menu',
      target: 'graphBtn_expand',
      body: 'Layout ▾ opens Highlight New (gold rings on unseen nodes) and Organize (preview layout for nodes you have not moved by hand).',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_dm_view',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'DM view',
      title: 'DM View',
      target: 'graphBtn_dmview',
      body: 'DM View toggles DM-only notes in the graph. In demo mode, all users can view the DM surfaces, but demo writes remain admin-only.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_legend',
      chapterId: 'web',
      chapter: 'Web',
      subsection: 'Legend',
      title: 'Legend',
      target: 'graphLegendTab',
      body: 'The legend explains note categories and connection styles.',
      ui: { view: 'graph', graphForce2D: true },
    },
    {
      id: 'web_3d_controls',
      chapterId: 'web',
      chapter: 'Web',
      subsection: '3D controls',
      title: 'Controls in 3D',
      target: 'graph3dControlsTab',
      body: 'In 3D, use the controls panel to learn orbit, pan, zoom, and selection gestures.',
      ui: { view: 'graph', graphForce3D: true },
    },
  ];
}

function buildJournalChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'journal_intro',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Overview',
      title: 'Session journal',
      target: 'journalShell',
      body: 'The Journal captures live session notes, prep checklists, attendance, and recaps per campaign.',
      ui: { view: 'journal', selectSunkenVale: true },
    },
    {
      id: 'journal_campaign_select',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Campaign',
      title: 'Campaign selection',
      target: 'journalCampaignPicker',
      body: 'Pick a campaign folder to view its sessions and entries.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_lore',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Lore so far',
      title: 'Lore So Far',
      target: 'journalLoreBtn',
      body: 'Lore So Far is an AI-generated campaign summary built from notes you can see, journal entries, and connections.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_new_session',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'New session',
      title: 'New session',
      target: 'journalNewSessionBtn',
      body: 'Start a new session for the active campaign.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_session_notes',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Notes',
      title: 'Session notes',
      target: 'journalSessionsList',
      body: 'Add entries during play. Indent to capture subpoints, and promote entries into full notes when needed.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_continue',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Continue',
      title: 'Continue session',
      target: 'journalContinueBtn',
      body: 'Continue merges a session into the previous one (useful if you accidentally started a new session).',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_move',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Move',
      title: 'Move session',
      target: 'journalMoveBtn',
      body: 'Move a session to another campaign folder when the party switches storylines.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_prep',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Prep',
      title: 'Prep checklist',
      target: 'journalPrepBtn',
      body: 'DM prep checklist helps track what you need before the next game.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_roll',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Roll',
      title: 'Attendance roll',
      target: 'journalRollBtn',
      body: 'Track who attended each session.',
      ui: { view: 'journal' },
    },
    {
      id: 'journal_recap',
      chapterId: 'journal',
      chapter: 'Journal',
      subsection: 'Recap',
      title: 'Recaps',
      target: 'journalRecapBtn',
      body: 'Generate and view session recaps (requires AI enabled and a configured key).',
      ui: { view: 'journal' },
    },
  ];
}

function buildBackupsChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'backups_intro',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Sunken Vale root',
      title: 'Campaign root actions',
      target: 'sidebar',
      body: 'Select the Sunken Vale root in the sidebar to reveal backup and maintenance actions.',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
    {
      id: 'backups_snapshot',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Snapshots',
      title: '📷 Snapshot',
      target: 'backupBtn_snapshot',
      highlightVariant: 'danger',
      body: 'Create and restore snapshots for this campaign. Use snapshots before big edits or imports.',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
    {
      id: 'backups_export',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Export',
      title: '💾 Export JSON + HTML',
      target: 'backupBtn_export',
      highlightVariant: 'danger',
      body: 'Downloads a JSON export (admin import) and an HTML viewer (read-only browsing / sharing).',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
    {
      id: 'backups_sync',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Sync',
      title: '⟳ Sync visibility',
      target: 'backupBtn_sync',
      highlightVariant: 'danger',
      body: 'Propagates a folder’s visibility/permissions to all children. Use when reorganizing campaign access.',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
    {
      id: 'backups_rename',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Rename',
      title: '✎ Rename',
      target: 'backupBtn_rename',
      highlightVariant: 'danger',
      body: 'Rename the campaign root in the sidebar.',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
    {
      id: 'backups_delete',
      chapterId: 'backups',
      chapter: 'Backups',
      subsection: 'Delete',
      title: '× Delete',
      target: 'backupBtn_delete',
      highlightVariant: 'danger',
      body: 'Deletes the campaign root (and everything inside). Use with care.',
      ui: { view: 'notes', selectSunkenVale: true, forceShowBackupActions: true },
    },
  ];
}

function buildUsersChapterSteps() {
  /** @type {TutorialStep[]} */
  return [
    {
      id: 'users_tutorial',
      chapterId: 'users',
      chapter: 'Users',
      subsection: 'Tutorial',
      title: 'Tutorial',
      target: 'userMenuTutorial',
      body: 'Reopen the tutorial any time from the user menu.',
      ui: { view: 'notes', openUserMenu: true },
    },
    {
      id: 'users_hide_demo',
      chapterId: 'users',
      chapter: 'Users',
      subsection: 'Hide demo',
      title: 'Hide demo folders',
      target: 'userMenuHideDemo',
      body: 'Hide or show demo folders in the sidebar, graph, journal, and timeline pickers.',
      ui: { view: 'notes', openUserMenu: true },
    },
    {
      id: 'users_trash',
      chapterId: 'users',
      chapter: 'Users',
      subsection: 'Trash',
      title: 'Trash',
      target: 'userMenuTrash',
      body: 'Trash shows recently deleted notes and folders and lets you restore them.',
      ui: { view: 'notes', openUserMenu: true },
    },
    {
      id: 'users_leave',
      chapterId: 'users',
      chapter: 'Users',
      subsection: 'Leave',
      title: 'Leave',
      target: 'userMenuLeave',
      body: 'Leave signs you out on this device.',
      ui: { view: 'notes', openUserMenu: true },
    },
  ];
}

function buildChaptersFromSteps(steps) {
  const seen = new Set();
  const out = [];
  for (const s of steps) {
    if (!seen.has(s.chapterId)) {
      seen.add(s.chapterId);
      out.push({ id: s.chapterId, label: s.chapter });
    }
  }
  return out;
}

