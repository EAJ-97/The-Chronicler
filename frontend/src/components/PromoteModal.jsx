import { useState, useMemo } from 'react';
import { getCategoryColor } from './NoteEditor.jsx';

const CATEGORIES = [
  { value: 'npc',      label: 'NPC / Character' },
  { value: 'location', label: 'Location' },
  { value: 'faction',  label: 'Faction / Org' },
  { value: 'item',     label: 'Item / Artifact' },
  { value: 'event',    label: 'Quest / Event' },
  { value: 'lore',     label: 'Lore / History' },
  { value: 'general',  label: 'General' },
];

function buildFolderTree(notes) {
  const folders = notes.filter(n => n.is_folder);
  const map = {};
  const roots = [];
  folders.forEach(n => { map[n.id] = { ...n, children: [] }; });
  folders.forEach(n => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });
  return roots;
}

function buildNoteTree(notes) {
  // Build a tree of folders + notes for the append picker
  const map = {};
  notes.forEach(n => { map[n.id] = { ...n, children: [] }; });
  const roots = [];
  notes.forEach(n => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });
  return roots;
}

function FolderOption({ node, depth, selected, onSelect }) {
  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        style={{
          padding: `8px 12px 8px ${14 + depth * 18}px`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          background: selected === node.id ? 'rgba(200,148,58,0.12)' : 'transparent',
          border: `1px solid ${selected === node.id ? 'rgba(200,148,58,0.25)' : 'transparent'}`,
          borderRadius: '3px', marginBottom: '2px',
        }}
        onMouseEnter={e => { if (selected !== node.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { if (selected !== node.id) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ fontSize: '12px' }}>{selected === node.id ? '📂' : '📁'}</span>
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.05em', color: selected === node.id ? '#c8943a' : 'rgba(226,213,187,0.7)' }}>
          {node.title}
        </span>
      </div>
      {node.children.map(c => <FolderOption key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
    </>
  );
}

function NoteTreePicker({ nodes, selectedNote, onSelect, depth = 0 }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <>
      {nodes.map(node => {
        const isFolder  = !!node.is_folder;
        const isNote    = !isFolder;
        const isOpen    = !collapsed[node.id];
        const hasKids   = node.children?.length > 0;
        const isSelected = selectedNote === node.id;

        if (isFolder) {
          return (
            <div key={node.id}>
              <div
                onClick={() => hasKids && toggle(node.id)}
                style={{ padding: `6px 10px 6px ${12 + depth * 16}px`, cursor: hasKids ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '7px', borderRadius: '3px', userSelect: 'none' }}
                onMouseEnter={e => { if (hasKids) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: '10px', color: 'rgba(200,148,58,0.5)', width: '10px', flexShrink: 0 }}>{hasKids ? (isOpen ? '▾' : '▸') : ' '}</span>
                <span style={{ fontSize: '11px' }}>📁</span>
                <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(200,148,58,0.65)' }}>{node.title}</span>
              </div>
              {isOpen && hasKids && (
                <NoteTreePicker nodes={node.children} selectedNote={selectedNote} onSelect={onSelect} depth={depth + 1} />
              )}
            </div>
          );
        }

        return (
          <div key={node.id}
            onClick={() => onSelect(node.id)}
            style={{ padding: `6px 10px 6px ${12 + depth * 16}px`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', background: isSelected ? 'rgba(200,148,58,0.12)' : 'transparent', border: `1px solid ${isSelected ? 'rgba(200,148,58,0.25)' : 'transparent'}`, borderRadius: '3px', marginBottom: '1px' }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: '10px', flexShrink: 0 }} />
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: getCategoryColor(node.category), flexShrink: 0 }} />
            <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: isSelected ? '#e2d5bb' : 'rgba(226,213,187,0.65)' }}>{node.title}</span>
          </div>
        );
      })}
    </>
  );
}

export default function PromoteModal({ entry, notes, entries = [], buildMarkdown, onConfirm, onClose }) {
  const isParent = (entry.indent_level || 0) === 0;

  // For parent: detect how many children follow
  const childCount = useMemo(() => {
    if (!isParent || !entries.length) return 0;
    const idx = entries.findIndex(e => e.id === entry.id);
    let count = 0;
    for (let i = idx + 1; i < entries.length; i++) {
      if ((entries[i].indent_level || 0) === 0) break;
      count++;
    }
    return count;
  }, [entry.id, entries, isParent]);

  const markdownContent = useMemo(() => buildMarkdown ? buildMarkdown(entry) : '', [entry, buildMarkdown]);

  const firstLine = entry.content.split('\n')[0].slice(0, 80) || 'Journal Note';
  const [title, setTitle]               = useState(firstLine);
  const [category, setCategory]         = useState('general');
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);

  const [confirming, setConfirming]     = useState(false);

  // mode: 'create' (parent or explicit) | 'append' (child)
  const [mode, setMode] = useState(isParent ? 'create' : 'append');

  const tree = buildFolderTree(notes);
  const selectedFolderName = notes.find(n => n.id === selectedFolder)?.title;
  const selectedNoteName   = notes.find(n => n.id === selectedNote)?.title;

  const handleConfirm = async () => {
    setConfirming(true);
    if (mode === 'append') {
      await onConfirm({ entryId: entry.id, mode: 'append', target_note_id: selectedNote, markdown_content: markdownContent });
    } else {
      await onConfirm({ entryId: entry.id, mode: 'create', title, category, parent_id: selectedFolder, markdown_content: markdownContent });
    }
    setConfirming(false);
  };

  const canConfirm = mode === 'append' ? !!selectedNote : !!title.trim();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: '480px', maxHeight: '85vh',
        background: 'var(--ch-card-bg)', border: '1px solid var(--ch-border-strong)',
        borderRadius: '4px', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 60px rgba(0,0,0,0.9)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.2em', color: 'var(--ch-accent)' }}>PROMOTE TO NOTE</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {/* Entry preview */}
          <div style={{ padding: '10px 14px', marginBottom: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '3px', borderLeft: '2px solid rgba(200,148,58,0.3)' }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)', marginBottom: '6px' }}>
              JOURNAL ENTRY {childCount > 0 ? `+ ${childCount} CHILD ${childCount === 1 ? 'LINE' : 'LINES'}` : ''}
            </div>
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.6)', lineHeight: '1.5' }}>
              {entry.content.length > 100 ? entry.content.slice(0, 100) + '...' : entry.content}
            </div>
          </div>

          {/* Mode toggle — only shown for indented entries (parents always create) */}
          {!isParent && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
              {[{ v: 'create', l: '+ Create New Note' }, { v: 'append', l: '→ Append to Note' }].map(({ v, l }) => (
                <button key={v} onClick={() => setMode(v)}
                  style={{ flex: 1, padding: '7px', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', borderRadius: '3px', cursor: 'pointer', background: mode === v ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === v ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.08)'}`, color: mode === v ? '#c8943a' : 'rgba(226,213,187,0.35)' }}>
                  {l}
                </button>
              ))}
            </div>
          )}

          {/* Markdown preview of what will be written */}
          {markdownContent && (
            <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(200,148,58,0.04)', border: '1px solid var(--ch-border)', borderRadius: '3px' }}>
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)', marginBottom: '6px' }}>WILL BE WRITTEN AS</div>
              <pre style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(226,213,187,0.5)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{markdownContent}</pre>
            </div>
          )}

          {mode === 'create' ? (
            <>
              {/* Note title */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>NOTE TITLE</div>
                <input
                  style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ch-border-strong)', borderRadius: '3px', color: 'var(--ch-text-primary)', fontFamily: 'Crimson Pro, serif', fontSize: '16px', padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  autoFocus
                />
              </div>
              {/* Category */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>CATEGORY</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {CATEGORIES.map(c => {
                    const active = category === c.value;
                    const col = getCategoryColor(c.value);
                    return (
                      <button key={c.value} onClick={() => setCategory(c.value)}
                        style={{ padding: '5px 10px', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.08em', background: active ? `${col}22` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? col : 'rgba(255,255,255,0.08)'}`, color: active ? col : 'rgba(226,213,187,0.4)' }}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Folder picker */}
              <div>
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '8px' }}>
                  PLACE IN FOLDER {selectedFolderName && <span style={{ marginLeft: '8px', color: 'var(--ch-accent)' }}>→ {selectedFolderName}</span>}
                </div>
                <div onClick={() => setSelectedFolder(null)}
                  style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', background: selectedFolder === null ? 'rgba(200,148,58,0.08)' : 'transparent', border: `1px solid ${selectedFolder === null ? 'rgba(200,148,58,0.2)' : 'transparent'}`, borderRadius: '3px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '12px' }}>📂</span>
                  <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', color: selectedFolder === null ? 'rgba(200,148,58,0.7)' : 'rgba(226,213,187,0.3)' }}>No folder (root level)</span>
                </div>
                {tree.map(node => <FolderOption key={node.id} node={node} depth={0} selected={selectedFolder} onSelect={setSelectedFolder} />)}
              </div>
            </>
          ) : (
            /* Append mode: hierarchical note tree picker */
            <div>
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '8px' }}>
                APPEND TO NOTE {selectedNoteName && <span style={{ marginLeft: '8px', color: 'var(--ch-accent)' }}>→ {selectedNoteName}</span>}
              </div>
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '3px', padding: '4px' }}>
                <NoteTreePicker nodes={buildNoteTree(notes)} selectedNote={selectedNote} onSelect={setSelectedNote} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ padding: '8px 18px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.4)' }}>
            CANCEL
          </button>
          <button onClick={handleConfirm} disabled={!canConfirm || confirming}
            style={{ padding: '8px 22px', borderRadius: '3px', cursor: canConfirm ? 'pointer' : 'not-allowed', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', background: canConfirm ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${canConfirm ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.06)'}`, color: canConfirm ? '#c8943a' : 'rgba(226,213,187,0.2)' }}>
            {confirming ? 'SAVING...' : mode === 'append' ? 'APPEND TO NOTE' : 'CREATE NOTE'}
          </button>
        </div>
      </div>
    </div>
  );
}
