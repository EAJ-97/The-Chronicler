import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getCategoryColor } from './NoteEditor.jsx';

export default function NotePanel({ note, notes, connections, onClose }) {
  const color = getCategoryColor(note?.category);

  return (
    <div style={{
      width: '300px',
      flexShrink: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0c14',
      borderRight: '1px solid rgba(200,148,58,0.15)',
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
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

      <style>{`
        .md-preview h1, .md-preview h2, .md-preview h3 { font-family: 'Cinzel', serif; color: #c8943a; margin: 14px 0 6px; letter-spacing: 0.04em; }
        .md-preview h1 { font-size: 16px; } .md-preview h2 { font-size: 14px; } .md-preview h3 { font-size: 13px; }
        .md-preview p { margin: 0 0 8px; }
        .md-preview ul, .md-preview ol { padding-left: 18px; margin: 0 0 8px; }
        .md-preview li { margin-bottom: 3px; }
        .md-preview blockquote { border-left: 2px solid rgba(200,148,58,0.3); margin: 0 0 8px; padding: 4px 10px; color: rgba(226,213,187,0.5); font-style: italic; }
        .md-preview code { background: rgba(255,255,255,0.06); border-radius: 2px; padding: 1px 5px; font-size: 13px; font-family: monospace; }
        .md-preview strong { color: #e2d5bb; font-weight: 600; }
        .md-preview em { color: rgba(226,213,187,0.75); }
        .md-preview hr { border: none; border-top: 1px solid rgba(200,148,58,0.15); margin: 12px 0; }
        .md-preview a { color: #c8943a; }
      `}</style>
    </div>
  );
}
