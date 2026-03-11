import { useState, useEffect, useRef } from 'react';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(7,8,14,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(2px)',
  },
  modal: {
    background: '#0e1020',
    border: '1px solid rgba(200,148,58,0.25)',
    borderRadius: '6px',
    width: '420px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
  },
  header: {
    padding: '18px 20px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'Cinzel Decorative, serif',
    fontSize: '13px',
    color: '#c8943a',
    letterSpacing: '0.03em',
    marginBottom: '4px',
  },
  subtitle: {
    fontFamily: 'Crimson Pro, serif',
    fontSize: '13px',
    color: 'rgba(226,213,187,0.4)',
    fontStyle: 'italic',
  },
  body: {
    padding: '18px 20px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  label: {
    fontFamily: 'Cinzel',
    fontSize: '8px',
    letterSpacing: '0.15em',
    color: 'rgba(200,148,58,0.6)',
    marginBottom: '6px',
    display: 'block',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    padding: '8px 10px',
    fontFamily: 'Crimson Pro, serif',
    fontSize: '15px',
    color: '#e2d5bb',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  memberList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  memberRow: (isDM) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 10px',
    borderRadius: '4px',
    background: isDM ? 'rgba(200,148,58,0.08)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${isDM ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.06)'}`,
    transition: 'all 0.15s',
  }),
  avatar: (isDM) => ({
    width: '22px', height: '22px', borderRadius: '50%',
    background: isDM ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${isDM ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Cinzel', fontSize: '9px', color: isDM ? '#c8943a' : 'rgba(226,213,187,0.5)',
    flexShrink: 0,
  }),
  memberName: {
    flex: 1,
    fontFamily: 'Crimson Pro, serif',
    fontSize: '14px',
    color: 'rgba(226,213,187,0.85)',
  },
  dmBadge: (active) => ({
    fontFamily: 'Cinzel',
    fontSize: '7px',
    letterSpacing: '0.12em',
    padding: '2px 7px',
    borderRadius: '10px',
    cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(200,148,58,0.6)' : 'rgba(255,255,255,0.1)'}`,
    background: active ? 'rgba(200,148,58,0.15)' : 'transparent',
    color: active ? '#c8943a' : 'rgba(226,213,187,0.3)',
    transition: 'all 0.15s',
    userSelect: 'none',
  }),
  removeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'rgba(224,112,112,0.4)', fontSize: '14px', lineHeight: 1,
    padding: '0 2px', flexShrink: 0,
    transition: 'color 0.15s',
  },
  addRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '6px',
  },
  addSelect: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    padding: '6px 8px',
    fontFamily: 'Crimson Pro, serif',
    fontSize: '14px',
    color: '#e2d5bb',
    outline: 'none',
    cursor: 'pointer',
  },
  addBtn: {
    background: 'rgba(200,148,58,0.1)',
    border: '1px solid rgba(200,148,58,0.3)',
    borderRadius: '4px',
    padding: '6px 14px',
    fontFamily: 'Cinzel',
    fontSize: '8px',
    letterSpacing: '0.1em',
    color: '#c8943a',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  footer: {
    padding: '14px 20px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexShrink: 0,
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid rgba(226,213,187,0.15)',
    borderRadius: '4px',
    padding: '7px 18px',
    fontFamily: 'Cinzel',
    fontSize: '9px',
    letterSpacing: '0.1em',
    color: 'rgba(226,213,187,0.4)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  confirmBtn: (disabled) => ({
    background: disabled ? 'rgba(200,148,58,0.05)' : 'rgba(200,148,58,0.15)',
    border: `1px solid ${disabled ? 'rgba(200,148,58,0.1)' : 'rgba(200,148,58,0.4)'}`,
    borderRadius: '4px',
    padding: '7px 22px',
    fontFamily: 'Cinzel',
    fontSize: '9px',
    letterSpacing: '0.1em',
    color: disabled ? 'rgba(200,148,58,0.25)' : '#c8943a',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s',
  }),
};

export default function CampaignModal({ currentUser, onConfirm, onClose }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const [campaignName, setCampaignName] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  // members: [{ user_id, username, is_dm }]
  const [members, setMembers] = useState([{ user_id: currentUser.id, username: currentUser.username, is_dm: true }]);
  const [selectedAdd, setSelectedAdd] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    api.get('/notes/meta/users').then(r => {
      setAllUsers(r.data);
      // Pre-select first non-member user in dropdown
      const nonMembers = r.data.filter(u => u.id !== currentUser.id);
      if (nonMembers.length > 0) setSelectedAdd(String(nonMembers[0].id));
    }).catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const availableToAdd = allUsers.filter(u => !members.some(m => m.user_id === u.id));

  const handleAddMember = () => {
    if (!selectedAdd) return;
    const user = allUsers.find(u => String(u.id) === String(selectedAdd));
    if (!user || members.some(m => m.user_id === user.id)) return;
    setMembers(prev => [...prev, { user_id: user.id, username: user.username, is_dm: false }]);
    // Advance dropdown to next available
    const remaining = availableToAdd.filter(u => String(u.id) !== String(selectedAdd));
    setSelectedAdd(remaining.length > 0 ? String(remaining[0].id) : '');
  };

  const handleRemove = (userId) => {
    if (userId === currentUser.id) return; // creator can't be removed
    setMembers(prev => prev.filter(m => m.user_id !== userId));
  };

  const handleToggleDM = (userId) => {
    setMembers(prev => prev.map(m =>
      m.user_id === userId ? { ...m, is_dm: !m.is_dm } : m
    ));
  };

  const handleConfirm = () => {
    if (!campaignName.trim()) return;
    onConfirm({ title: campaignName.trim(), members });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && campaignName.trim()) handleConfirm();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={isMobile ? { ...S.modal, width: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, border: 'none' } : S.modal}>
        <div style={S.header}>
          <div style={S.title}>New Campaign</div>
          <div style={S.subtitle}>Name your chronicle and gather your party</div>
        </div>

        <div style={S.body}>
          {/* Campaign name */}
          <div>
            <label style={S.label}>CAMPAIGN NAME</label>
            <input
              ref={inputRef}
              style={S.input}
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="The Sunken Vale, Curse of Strahd…"
              maxLength={80}
            />
          </div>

          {/* Party members */}
          <div>
            <label style={S.label}>PARTY MEMBERS — CLICK DM TO DESIGNATE</label>
            <div style={S.memberList}>
              {members.map(m => (
                <div key={m.user_id} style={S.memberRow(m.is_dm)}>
                  <div style={S.avatar(m.is_dm)}>
                    {m.username[0].toUpperCase()}
                  </div>
                  <span style={S.memberName}>
                    {m.username}
                    {m.user_id === currentUser.id && (
                      <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.4)', marginLeft: '6px' }}>YOU</span>
                    )}
                  </span>
                  <span style={S.dmBadge(m.is_dm)} onClick={() => handleToggleDM(m.user_id)}>
                    DM
                  </span>
                  {m.user_id !== currentUser.id && (
                    <button style={S.removeBtn} onClick={() => handleRemove(m.user_id)} title="Remove">×</button>
                  )}
                </div>
              ))}
            </div>

            {availableToAdd.length > 0 && (
              <div style={S.addRow}>
                <select
                  style={S.addSelect}
                  value={selectedAdd}
                  onChange={e => setSelectedAdd(e.target.value)}
                >
                  {availableToAdd.map(u => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
                <button style={S.addBtn} onClick={handleAddMember}>+ Add</button>
              </div>
            )}

            {allUsers.length > 0 && availableToAdd.length === 0 && members.length > 1 && (
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.25)', fontStyle: 'italic', marginTop: '8px' }}>
                All known adventurers are in the party.
              </div>
            )}
          </div>
        </div>

        <div style={S.footer}>
          <button style={S.cancelBtn} onClick={onClose}>Dismiss</button>
          <button style={S.confirmBtn(!campaignName.trim())} onClick={handleConfirm} disabled={!campaignName.trim()}>
            Begin Chronicle
          </button>
        </div>
      </div>
    </div>
  );
}
