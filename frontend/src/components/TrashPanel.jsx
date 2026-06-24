import { useState, useEffect } from 'react';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 23) return `${Math.floor(h/24)}d ago`;
  if (h > 0)  return `${h}h ago`;
  return `${m}m ago`;
}

export default function TrashPanel({ currentUser, onClose, onRestored }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/notes/trash'); setItems(r.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleRestore = async (id) => {
    try {
      await api.post(`/notes/${id}/restore`);
      setItems(prev => prev.filter(i => i.id !== id));
      onRestored();
    } catch (e) { console.error(e); }
  };

  const handleClearLabel = async (id) => {
    try {
      const res = await api.put(`/notes/${id}/clear-recovered`);
      onRestored();
    } catch (e) { console.error(e); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f1117', border: isMobile ? 'none' : '1px solid rgba(200,148,58,0.2)', borderRadius: isMobile ? 0 : '6px', width: isMobile ? '100%' : '520px', height: isMobile ? '100%' : 'auto', maxHeight: isMobile ? '100%' : '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0 }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '12px', letterSpacing: '0.15em', color: 'var(--ch-accent)' }}>🗑 TRASH</span>
          <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.3)' }}>Items auto-purge after 48 hours</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--ch-font-display)', fontSize: '11px', color: 'rgba(200,148,58,0.3)', letterSpacing: '0.15em' }}>LOADING...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.25)' }}>Trash is empty</div>
          ) : (
            items.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{item.is_folder ? '📁' : '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'var(--ch-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.3)', marginTop: '2px' }}>
                    by {item.author} · deleted {timeAgo(item.deleted_at)}
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(item.id)}
                  style={{ background: 'rgba(200,148,58,0.1)', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', cursor: 'pointer', padding: isMobile ? '8px 14px' : '3px 10px', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', color: 'var(--ch-accent)', flexShrink: 0, minHeight: isMobile ? '40px' : 'auto' }}
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
