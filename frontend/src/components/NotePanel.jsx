import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildMarkdownComponents, MARKDOWN_BASE_CSS } from '../utils/markdownComponents.jsx';
import { getCategoryColor } from './NoteEditor.jsx';

/**
 * Graph-side note preview panel.
 * - Desktop: fixed 300px side panel.
 * - Mobile: the parent renders it inside a full-width bottom sheet.
 * @param {{ note: any, notes: any[], connections: any[], onClose: () => void, isMobile?: boolean }} props
 */
export default function NotePanel({ note, notes, connections, onClose, isMobile = false }) {
  const color = getCategoryColor(note?.category);

  return (
    <div style={{
      width: isMobile ? '100%' : '300px',
      flexShrink: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0c14',
      borderRight: isMobile ? 'none' : '1px solid rgba(200,148,58,0.15)',
      overflow: 'hidden',
    }}>
      {/* Colored accent bar */}
      <div style={{ height: '2px', background: `linear-gradient(90deg, ${color}, transparent)`, flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
        display: 'flex', alignItems: 'flex-start', gap: '10px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'Cinzel', fontSize: '13px', fontWeight: '500',
            color: '#e2d5bb', letterSpacing: '0.03em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: '4px',
          }}>
            {note?.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: `${color}aa`, textTransform: 'uppercase' }}>
              {note?.category}
            </span>
            {note?.is_shared || note?.visibility === 'shared' ? (
              <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.4)' }}>⚔ SHARED</span>
            ) : (note?.granted_users?.length > 0) ? (
              <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.3)' }}>👁 +{note.granted_users.length}</span>
            ) : (
              <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.2)' }}>🔒 PRIVATE</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.25)', fontSize: '18px', lineHeight: 1, padding: '0', flexShrink: 0, transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'rgba(226,213,187,0.7)'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(226,213,187,0.25)'}
        >×</button>      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Note content */}
        <div style={{
          padding: '16px',
          fontFamily: 'Crimson Pro, serif', fontSize: '15px',
          lineHeight: '1.75', color: '#e2d5bb',
        }}>
          {note?.content ? (
            <div className="md-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildMarkdownComponents()}>{note.content}</ReactMarkdown>
            </div>
          ) : (
            <span style={{ color: 'rgba(226,213,187,0.2)', fontStyle: 'italic' }}>No content yet.</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.04)',
        flexShrink: 0, fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
        color: 'rgba(200,148,58,0.2)', textAlign: 'center',
      }}>
        DOUBLE-CLICK NODE TO OPEN FULL EDITOR
      </div>

      <style>{MARKDOWN_BASE_CSS}</style>
    </div>
  );
}
