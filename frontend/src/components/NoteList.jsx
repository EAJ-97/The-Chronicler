import { useState, useCallback, useRef, useEffect } from 'react';
import { getCategoryColor } from './NoteEditor.jsx';
import api from '../api.js';
import { getCampaignFolderIdForSelection, isWorldRootSelected } from '../utils/campaignTree.js';
import { resolveSidebarIcon, isManagedSidebarIconUrl } from '../utils/displayIcons.js';

function buildTree(notes) {
  const map = {};
  const roots = [];
  notes.forEach(n => { map[n.id] = { ...n, children: [] }; });
  notes.forEach(n => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });

  function countNotes(node) {
    let count = node.is_folder ? 0 : 1;
    node.children.forEach(c => { count += countNotes(c); });
    node._noteCount = node.is_folder ? count : 0;
    return count;
  }

  const sortNodes = (arr) => {
    arr.sort((a, b) => {
      if (a.is_folder !== b.is_folder) return b.is_folder - a.is_folder;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.title.localeCompare(b.title);
    });
    arr.forEach(n => sortNodes(n.children));
  };

  roots.forEach(r => countNotes(r));
  sortNodes(roots);
  return roots;
}

// Check if targetId is a descendant of dragId (prevent dropping into own child)
function isDescendant(notes, dragId, targetId) {
  const map = {};
  notes.forEach(n => { map[n.id] = n; });
  let current = map[targetId];
  while (current) {
    if (current.parent_id === dragId) return true;
    current = map[current.parent_id];
  }
  return false;
}

const INDENT = 16;

function TreeNode({
  node, depth, selectedId, onSelect, onCreateNote, onCreateFolder,
  onDelete, expandedIds, onToggleExpand, currentUser, onRename,
  draggedId, onDragStart, onDragEnd, onDrop, dropTargetId, onSnapshot, onSync,
  allNotes, dmCampaignIds, simulatedRole, isMobile,
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { x, y }
  const tooltipTimer = useRef(null);
  const titleRef = useRef(null);
  const isFolder = !!node.is_folder;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = node.id === selectedId;
  const isAdmin = simulatedRole ? false : !!currentUser.is_admin;
  const isOwner = simulatedRole === 'owner' ? true
    : simulatedRole ? false
    : node.user_id === currentUser.id;
  const isDragging = draggedId === node.id;
  const isDropTarget = dropTargetId === node.id;

  // Determine if current user is DM of the campaign containing this node
  const isDM = (() => {
    if (isAdmin) return true;
    if (!dmCampaignIds || dmCampaignIds.length === 0) return false;
    const notesById = new Map((allNotes || []).map(n => [n.id, n]));
    let current = node;
    while (current.parent_id) {
      current = notesById.get(current.parent_id);
      if (!current) return false;
    }
    return dmCampaignIds.includes(current.id);
  })();

  const isRootFolder = isFolder && depth === 0;
  const canManage = isRootFolder ? (isAdmin || isDM) : (isAdmin || isOwner || isDM);
  const indent = depth * INDENT + 10;

  const rowStyle = {
    display: 'flex', alignItems: 'center',
    padding: isMobile ? `10px 8px 10px ${indent}px` : `5px 8px 5px ${indent}px`,
    cursor: renaming ? 'default' : 'pointer', borderRadius: '3px',
    background: isDropTarget
      ? 'rgba(200,148,58,0.18)'
      : isSelected ? 'rgba(200,148,58,0.12)'
      : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
    border: `1px solid ${isDropTarget ? 'rgba(200,148,58,0.5)' : isSelected ? 'rgba(200,148,58,0.2)' : 'transparent'}`,
    marginBottom: '1px', gap: '6px', minHeight: isMobile ? '44px' : '28px',
    transition: 'background 0.1s',
    opacity: isDragging ? 0.35 : 1,
    touchAction: 'manipulation',
    WebkitUserSelect: 'none', userSelect: 'none',
  };

  const handleClick = () => {
    if (renaming) return;
    if (isFolder) onSelect(node.id);
    else onSelect(node.id);
  };

  const startRename = (e) => {
    e.stopPropagation();
    setRenameValue(node.title);
    setRenaming(true);
    setTimeout(() => { renameRef.current?.focus(); renameRef.current?.select(); }, 50);
  };

  const commitRename = async () => {
    const val = renameValue.trim();
    if (val && val !== node.title) await onRename(node.id, val);
    setRenaming(false);
  };

  const handleRenameKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') setRenaming(false);
  };

  return (
    <div>
      <div
        style={rowStyle}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (isFolder && draggedId !== node.id) e.dataTransfer.dropEffect = 'move'; }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); if (isFolder) onDrop(node.id); }}
      >
        {/* Drag handle */}
        {canManage && !renaming ? (
          <span
            draggable={!isMobile}
            onDragStart={e => { e.stopPropagation(); onDragStart(node.id); }}
            onDragEnd={e => { e.stopPropagation(); onDragEnd(); }}
            title="Drag to move"
            style={{ fontSize: '10px', color: hovered ? 'rgba(200,148,58,0.4)' : 'transparent', cursor: 'grab', flexShrink: 0, width: '10px', userSelect: 'none' }}
            onClick={e => e.stopPropagation()}
          >⠿</span>
        ) : <span style={{ width: '10px', flexShrink: 0 }} />}

        {/* Expand chevron for folders */}
        {isFolder ? (
          <span
            onClick={e => { e.stopPropagation(); onToggleExpand(node.id); }}
            style={{ fontSize: '9px', color: 'rgba(200,148,58,0.5)', width: '10px', flexShrink: 0, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', cursor: 'pointer', padding: '4px 2px', margin: '-4px -2px' }}
          >▶</span>
        ) : (
          <span style={{ width: '10px', flexShrink: 0 }} />
        )}

        {/* Icon — emoji, default by kind, or DM-uploaded image (managed URL only) */}
        <span
          style={{
            fontSize: isFolder ? '13px' : '14px', flexShrink: 0, lineHeight: 1,
            width: isFolder ? '22px' : '22px', height: '22px', textAlign: 'center',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={node.display_summary ? `${node.title}\n${node.display_summary}` : undefined}
        >
          {(() => {
            const ic = resolveSidebarIcon(node, allNotes || []);
            return isManagedSidebarIconUrl(ic) ? (
              <img
                src={ic}
                alt=""
                style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: '4px', display: 'block' }}
              />
            ) : (
              ic
            );
          })()}
        </span>

        {/* Title */}
        {renaming ? (
          <input
            ref={renameRef}
            style={{
              flex: 1, background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.3)',
              borderRadius: '2px', outline: 'none', color: '#e2d5bb', padding: '1px 6px',
              fontFamily: isFolder ? 'Cinzel' : 'Crimson Pro, serif',
              fontSize: isFolder ? '11px' : '14px', letterSpacing: isFolder ? '0.05em' : '0',
            }}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKey}
            onBlur={commitRename}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            ref={titleRef}
            style={{
              flex: 1, fontFamily: isFolder ? 'Cinzel' : 'Crimson Pro, serif',
              fontSize: isFolder ? '11px' : '14px', letterSpacing: isFolder ? '0.05em' : '0',
              color: isFolder ? 'rgba(226,213,187,0.7)' : '#e2d5bb',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              position: 'relative',
            }}
            onDoubleClick={canManage ? startRename : undefined}
            onMouseEnter={(e) => {
              const el = titleRef.current;
              if (!el || el.scrollWidth <= el.clientWidth) return; // not truncated
              clearTimeout(tooltipTimer.current);
              tooltipTimer.current = setTimeout(() => {
                const r = el.getBoundingClientRect();
                setTooltip({ x: r.left, y: r.bottom + 4 });
              }, 600);
            }}
            onMouseLeave={() => { clearTimeout(tooltipTimer.current); setTooltip(null); }}
          >
            {node.title}
            {tooltip && (
              <div style={{
                position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 999,
                background: '#1a1c26', border: '1px solid rgba(200,148,58,0.3)',
                borderRadius: '3px', padding: '6px 12px', pointerEvents: 'none',
                fontFamily: isFolder ? 'Cinzel' : 'Crimson Pro, serif',
                fontSize: isFolder ? '11px' : '14px',
                color: isFolder ? 'rgba(226,213,187,0.9)' : '#e2d5bb',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                maxWidth: 'min(320px, 90vw)',
              }}>
                <div style={{ fontWeight: 600, marginBottom: node.display_summary ? '4px' : 0 }}>{node.title}</div>
                {node.display_summary ? (
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.55)', whiteSpace: 'normal', lineHeight: 1.35 }}>
                    {node.display_summary}
                  </div>
                ) : null}
              </div>
            )}
            {!!node.is_shared && !isFolder && (
              <span style={{ marginLeft: '5px', fontSize: '9px', color: 'rgba(200,148,58,0.4)', fontFamily: 'Cinzel' }}>⚔</span>
            )}
            {node.visibility === 'hidden' && !isOwner && !isDM && (
              <span style={{ marginLeft: '5px', fontSize: '9px', color: 'rgba(226,213,187,0.25)' }} title="You have granted access">👁</span>
            )}
            {!!node.recovered && (
              <span style={{ marginLeft: '5px', fontSize: '8px', color: 'rgba(139,196,226,0.5)', fontFamily: 'Cinzel', letterSpacing: '0.05em' }} title="Restored from trash">↩ recovered</span>
            )}
          </span>
        )}

        {isRootFolder && isDM && !isAdmin && !renaming && (
          <span title="You are DM of this campaign" style={{ fontSize: '10px', flexShrink: 0, opacity: 0.7, lineHeight: 1 }}>⚔</span>
        )}

        {isFolder && node._noteCount > 0 && !hovered && !renaming && (
          <span style={{ fontFamily: 'Cinzel', fontSize: '8px', color: 'rgba(200,148,58,0.3)', background: 'rgba(200,148,58,0.06)', border: '1px solid rgba(200,148,58,0.12)', borderRadius: '10px', padding: '1px 6px', flexShrink: 0 }}>
            {node._noteCount}
          </span>
        )}

        {(hovered || (isMobile && isSelected)) && canManage && !renaming && (
          <span style={{ display: 'flex', gap: isMobile ? '6px' : '2px', flexShrink: 0 }}>
            {isFolder && depth === 0 && (
              <span title="Campaign snapshot" style={isMobile ? mobileActionBtn : actionBtn} onClick={e => { e.stopPropagation(); onSnapshot(node.id); }}>📷</span>
            )}
            {isFolder && canManage && (
              <span title="Sync visibility to all children" style={isMobile ? mobileActionBtn : actionBtn} onClick={e => { e.stopPropagation(); onSync(node.id, node.title); }}>⟳</span>
            )}
            {canManage && !isMobile && <span title="Rename" style={actionBtn} onClick={startRename}>✎</span>}
            {canManage && !isMobile && <span title="Delete" style={{ ...actionBtn, color: 'rgba(224,112,112,0.6)' }} onClick={e => { e.stopPropagation(); onDelete(node.id, node.title, isFolder); }}>×</span>}
          </span>
        )}
      </div>

      {isFolder && isExpanded && node.children.map(child => (
        <TreeNode
          key={child.id} node={child} depth={depth + 1}
          selectedId={selectedId} onSelect={onSelect}
          onCreateNote={onCreateNote} onCreateFolder={onCreateFolder}
          onDelete={onDelete} expandedIds={expandedIds} onToggleExpand={onToggleExpand}
          currentUser={currentUser} onRename={onRename}
          draggedId={draggedId} onDragStart={onDragStart} onDragEnd={onDragEnd}
          onDrop={onDrop} dropTargetId={dropTargetId} onSnapshot={onSnapshot} onSync={onSync}
          allNotes={allNotes} dmCampaignIds={dmCampaignIds} simulatedRole={simulatedRole}
          isMobile={isMobile}
        />
      ))}
    </div>
  );
}


const actionBtn = {
  fontSize: '13px', padding: '0 2px', cursor: 'pointer',
  color: 'rgba(226,213,187,0.4)', lineHeight: '1', borderRadius: '2px',
  WebkitUserSelect: 'none', userSelect: 'none',
};

const mobileActionBtn = {
  fontSize: '15px', padding: '0 4px', cursor: 'pointer',
  color: 'rgba(226,213,187,0.5)', lineHeight: '1', borderRadius: '3px',
  minWidth: '28px', minHeight: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  WebkitUserSelect: 'none', userSelect: 'none',
};

export default function NoteList({ notes, selectedId, onSelect, onDeselect, onCreateNote, onCreateFolder, onOpenCampaignModal, onDelete, onRename, onMove, onSnapshot, onSync, currentUser, dmCampaignIds, simulatedRole, collapsed, onToggleCollapse, isMobile }) {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [activeTag, setActiveTag] = useState(new Set());
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const searchTimer = useRef(null);
  const expandKey = `chronicler_expanded_${currentUser?.id || 'anon'}`;
  const [expandedIds, setExpandedIds] = useState(() => {
    try {
      const saved = localStorage.getItem(expandKey);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    const s = new Set();
    notes.filter(n => n.is_folder && !n.parent_id).forEach(n => s.add(n.id));
    return s;
  });

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(expandKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [expandKey]);

  // Debounced search — # prefix filters by tag instead
  useEffect(() => {
    if (!search.trim() || search.trim().length < 3) { setSearchResults(null); return; }
    if (search.startsWith('#')) { setSearchResults(null); return; } // tag mode — handled inline
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/notes/search', { params: { q: search } });
        setSearchResults(res.data);
      } catch (e) { setSearchResults([]); }
      setSearching(false);
    }, 300);
  }, [search]);

  // Drag handlers
  const handleDragStart = useCallback((id) => setDraggedId(id), []);
  const handleDragEnd = useCallback(() => { setDraggedId(null); setDropTargetId(null); }, []);

  const handleDrop = useCallback(async (targetFolderId) => {
    if (!draggedId || draggedId === targetFolderId) return;
    if (isDescendant(notes, draggedId, targetFolderId)) return; // can't drop into own child
    setDraggedId(null);
    setDropTargetId(null);
    setExpandedIds(prev => { const next = new Set(prev); next.add(targetFolderId); return next; }); // auto-expand target
    await onMove(draggedId, targetFolderId);
  }, [draggedId, notes, onMove]);

  // Root drop zone (move to root/no parent)
  const handleRootDrop = useCallback(async (e) => {
    e.preventDefault();
    if (!draggedId) return;
    setDraggedId(null);
    setDropTargetId(null);
    await onMove(draggedId, null);
  }, [draggedId, onMove]);

  const allTagsInNotes = [...new Set(notes.flatMap(n => n.tags || []))].sort();

  // Playable campaign folder for +Folder (not the world layer root — that wrongly parented new folders under the world)
  const campaignFolderId = getCampaignFolderIdForSelection(notes, selectedId);
  const worldRowSelected = isWorldRootSelected(notes, selectedId);
  const insideCampaign = campaignFolderId != null;
  const tagFilteredNotes = activeTag.size > 0
    ? notes.filter(n => (n.tags || []).some(t => activeTag.has(t)) || n.is_folder)
    : notes;
  const tree = buildTree(tagFilteredNotes);

  return (
    <div
      style={{ width: isMobile ? '100%' : (collapsed ? '0px' : '260px'), flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0a0c14', borderRight: '1px solid rgba(255,255,255,0.05)', height: '100%', transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)', overflow: 'visible', position: 'relative' }}
      onDragOver={e => e.preventDefault()}
      onDrop={handleRootDrop}
    >
      {/* Tab toggle — floats off the right edge of the sidebar at the top (desktop only) */}
      {!isMobile && (
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute', top: '10px', right: '-14px',
            zIndex: 20, width: '14px', height: '48px',
            background: '#0a0c14',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: 'none',
            borderRadius: '0 4px 4px 0',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(200,148,58,0.5)', fontSize: '8px',
            padding: 0, transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(200,148,58,0.1)'; e.currentTarget.style.color = '#c8943a'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0a0c14'; e.currentTarget.style.color = 'rgba(200,148,58,0.5)'; }}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      )}

      {/* Full sidebar content — clipped when collapsed */}
      <div style={{ width: isMobile ? '100%' : '260px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {!collapsed && (<>
      {/* Header */}
      <div style={{ padding: '12px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            style={{ width: '100%', background: activeTag.size > 0 ? 'rgba(200,148,58,0.06)' : 'rgba(255,255,255,0.04)', border: `1px solid ${activeTag.size > 0 ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '3px', color: '#e2d5bb', fontSize: '13px', fontFamily: 'Crimson Pro, serif', padding: '7px 10px', outline: 'none', boxSizing: 'border-box', paddingRight: activeTag.size > 0 ? '80px' : '10px' }}
            placeholder={activeTag.size > 0 ? `Search within ${activeTag.size} tag${activeTag.size > 1 ? 's' : ''}...` : 'Search notes... or #tag'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {activeTag.size > 0 && !search && (
            <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.08em', color: 'rgba(200,148,58,0.5)', pointerEvents: 'none' }}>
              SCOPED
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button style={{ ...newBtn, padding: isMobile ? '11px 0' : '7px 0' }} onClick={() => onCreateNote(null)}>+ Note</button>
          {insideCampaign ? (
            <button style={{ ...newBtn, padding: isMobile ? '11px 0' : '7px 0' }} onClick={() => onCreateFolder(campaignFolderId)}>+ Folder</button>
          ) : worldRowSelected ? (
            <button style={{ ...newBtn, padding: isMobile ? '11px 0' : '7px 0' }} onClick={() => onOpenCampaignModal?.({ underWorldId: selectedId })}>+ Campaign</button>
          ) : (
            <>
              <button style={{ ...newBtn, padding: isMobile ? '11px 0' : '7px 0', flex: isMobile ? '1 1 45%' : 1, minWidth: 0 }} onClick={() => onOpenCampaignModal?.({ initialCreationType: 'world' })}>+ World</button>
              <button style={{ ...newBtn, padding: isMobile ? '11px 0' : '7px 0', flex: isMobile ? '1 1 45%' : 1, minWidth: 0 }} onClick={() => onOpenCampaignModal?.({ initialCreationType: 'campaign' })}>+ Campaign</button>
            </>
          )}
        </div>
      </div>

      {/* Tag filter bar — shown when no search, or when search starts with # */}
      {allTagsInNotes.length > 0 && (() => {
        const tagQuery = search.startsWith('#') ? search.slice(1).toLowerCase() : '';
        const filteredTags = tagQuery ? allTagsInNotes.filter(t => t.toLowerCase().includes(tagQuery)) : allTagsInNotes;
        return (
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
            <div style={{ padding: '3px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '18px' }}>
              <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: activeTag.size > 0 ? 'rgba(200,148,58,0.5)' : 'transparent' }}>
                {activeTag.size > 0 ? `${activeTag.size} TAG${activeTag.size > 1 ? 'S' : ''} ACTIVE` : ' '}
              </span>
              <button onClick={() => setActiveTag(new Set())} style={{ background: 'none', border: 'none', cursor: activeTag.size > 0 ? 'pointer' : 'default', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: activeTag.size > 0 ? 'rgba(200,148,58,0.5)' : 'transparent', padding: '2px 4px', pointerEvents: activeTag.size > 0 ? 'auto' : 'none' }}>
                CLEAR ×
              </button>
            </div>
            <div style={{
              padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '4px',
              maxHeight: '88px', overflowY: 'auto',
            }}>
              {filteredTags.length === 0 && tagQuery && (
                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.25)', padding: '2px 4px' }}>
                  No tags matching #{tagQuery}
                </span>
              )}
              {filteredTags.map(tag => (
                <button key={tag} onClick={() => setActiveTag(prev => {
                  const next = new Set(prev);
                  next.has(tag) ? next.delete(tag) : next.add(tag);
                  return next;
                })} style={{
                  padding: '2px 8px', borderRadius: '10px', cursor: 'pointer', border: '1px solid',
                  fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.05em',
                  background: activeTag.has(tag) ? 'rgba(200,148,58,0.15)' : 'transparent',
                  borderColor: activeTag.has(tag) ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.1)',
                  color: activeTag.has(tag) ? '#c8943a' : 'rgba(226,213,187,0.35)',
                }}>#{tag}</button>
              ))}
            </div>
          </div>
        );
      })()}



      {/* Tree or search results */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '6px 4px', paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : '6px' }}
        onClick={e => { if (e.target === e.currentTarget) onDeselect?.(); }}
      >
        {search && !search.startsWith('#') && search.trim().length >= 3 ? (
          searching ? (
            <div style={{ ...emptyStyle, opacity: 0.4 }}>Searching...</div>
          ) : !searchResults || searchResults.length === 0 ? (
            <div style={emptyStyle}>{activeTag.size > 0 ? `No results for "${search}" in selected tags` : `No results for "${search}"`}</div>
          ) : (() => {
            const filteredResults = activeTag.size > 0
              ? searchResults.filter(n => (n.tags || []).some(t => activeTag.has(t)))
              : searchResults;
            return filteredResults.length === 0 ? (
              <div style={emptyStyle}>{activeTag.size > 0 ? `No results for "${search}" in selected tags` : `No results for "${search}"`}</div>
            ) : filteredResults.map(n => (
              <div key={n.id} style={{
                padding: '8px 10px', borderRadius: '3px', cursor: 'pointer', marginBottom: '3px',
                background: n.id === selectedId ? 'rgba(200,148,58,0.12)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${n.id === selectedId ? 'rgba(200,148,58,0.2)' : 'transparent'}`,
              }} onClick={() => onSelect(n.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: n.snippet ? '4px' : 0 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: getCategoryColor(n.category), flexShrink: 0 }} />
                  <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: '#e2d5bb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                </div>
                {n.snippet && (
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.4)', lineHeight: '1.4', paddingLeft: '14px' }}
                    dangerouslySetInnerHTML={{ __html: n.snippet.replace(/<mark>/g, '<mark style="background:rgba(200,148,58,0.3);color:#e2d5bb;border-radius:2px">') }}
                  />
                )}
              </div>
            ));
          })()
        ) : (
          tree.length === 0 ? (
            <div style={emptyStyle}>{activeTag.size > 0 ? `No notes tagged ${[...activeTag].map(t => '#'+t).join(', ')}` : 'No notes yet. Create your first entry.'}</div>
          ) : (
            tree.map(node => (
              <TreeNode
                key={node.id} node={node} depth={0}
                selectedId={selectedId} onSelect={onSelect}
                onCreateNote={onCreateNote} onCreateFolder={onCreateFolder}
                onDelete={onDelete} expandedIds={expandedIds} onToggleExpand={toggleExpand}
                currentUser={currentUser} onRename={onRename}
                draggedId={draggedId} onDragStart={handleDragStart}
                onDragEnd={handleDragEnd} onDrop={handleDrop} dropTargetId={dropTargetId}
                onSnapshot={onSnapshot}
                onSync={onSync}
                allNotes={notes} dmCampaignIds={dmCampaignIds} simulatedRole={simulatedRole}
                isMobile={isMobile}
              />
            ))
          )
        )}
      </div>
      </>)}
      </div>
    </div>
  );
}

const newBtn = {
  flex: 1, padding: '7px 0',
  background: 'rgba(200,148,58,0.1)', border: '1px solid rgba(200,148,58,0.2)',
  borderRadius: '3px', cursor: 'pointer',
  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: '#c8943a',
};

const emptyStyle = {
  padding: '24px 12px', textAlign: 'center',
  fontFamily: 'Crimson Pro, serif', fontSize: '14px',
  color: 'rgba(226,213,187,0.2)', whiteSpace: 'pre-line',
};
