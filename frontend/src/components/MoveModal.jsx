import { useState } from 'react';
import { getCategoryColor } from './NoteEditor.jsx';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

function buildFolderTree(notes, excludeId) {
  const folders = notes.filter(n => n.is_folder && n.id !== excludeId);
  const map = {};
  const roots = [];
  folders.forEach(n => { map[n.id] = { ...n, children: [] }; });
  folders.forEach(n => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });
  return roots;
}

function FolderOption({ node, depth, onSelect }) {
  return (
    <>
      <div
        style={{
          padding: `7px 12px 7px ${14 + depth * 16}px`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          fontFamily: 'var(--ch-font-display)', fontSize: '11px', color: 'rgba(226,213,187,0.7)',
          letterSpacing: '0.05em',
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(200,148,58,0.08)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span>📁</span>
        {node.title}
      </div>
      {node.children.map(c => <FolderOption key={c.id} node={c} depth={depth + 1} onSelect={onSelect} />)}
    </>
  );
}

export default function MoveModal({ note, notes, onMove, onClose }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const tree = buildFolderTree(notes, note.id);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : '24px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: isMobile ? '100%' : '360px',
        maxHeight: isMobile ? '100%' : '70vh', height: isMobile ? '100%' : 'auto',
        background: 'var(--ch-card-bg)', border: isMobile ? 'none' : '1px solid rgba(200,148,58,0.2)',
        borderRadius: isMobile ? 0 : '4px', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 40px rgba(0,0,0,0.8)',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.2em', color: 'var(--ch-accent)' }}>MOVE NOTE</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.3)', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>
        <div style={{ padding: '8px 0', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>
          {/* Option to move to root (no parent) */}
          <div
            style={{ padding: '7px 14px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '11px', color: 'rgba(226,213,187,0.4)', letterSpacing: '0.05em' }}
            onClick={() => onMove(null)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(200,148,58,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            📂 No folder (root level)
          </div>
          {tree.map(node => <FolderOption key={node.id} node={node} depth={0} onSelect={onMove} />)}
          {tree.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.2)' }}>
              No folders exist yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
