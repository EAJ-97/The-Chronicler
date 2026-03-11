import { useState, useEffect } from 'react';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  },
  panel: {
    width: '100%', maxWidth: '560px', maxHeight: '90vh',
    background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
    border: '1px solid rgba(200,148,58,0.25)', borderRadius: '4px',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 0 60px rgba(0,0,0,0.9)',
  },
  header: {
    padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'Cinzel', fontSize: '14px', letterSpacing: '0.2em',
    color: '#c8943a',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'rgba(226,213,187,0.3)', fontSize: '20px', lineHeight: 1,
    padding: '0 4px',
  },
  body: { flex: 1, overflowY: 'auto', padding: '20px 24px' },
  section: { marginBottom: '28px' },
  sectionTitle: {
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.25em',
    color: 'rgba(200,148,58,0.5)', textTransform: 'uppercase',
    marginBottom: '12px',
  },
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '3px',
  },
  toggleLabel: {
    fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: '#e2d5bb',
  },
  toggleSub: {
    fontFamily: 'Crimson Pro, serif', fontSize: '12px',
    color: 'rgba(226,213,187,0.35)', marginTop: '2px',
  },
  toggle: (on) => ({
    width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer',
    background: on ? 'rgba(200,148,58,0.7)' : 'rgba(255,255,255,0.1)',
    border: `1px solid ${on ? 'rgba(200,148,58,0.9)' : 'rgba(255,255,255,0.15)'}`,
    position: 'relative', transition: 'all 0.2s', flexShrink: 0,
  }),
  toggleDot: (on) => ({
    position: 'absolute', top: '2px',
    left: on ? '20px' : '2px',
    width: '16px', height: '16px', borderRadius: '50%',
    background: on ? '#c8943a' : 'rgba(255,255,255,0.3)',
    transition: 'all 0.2s',
  }),
  userRow: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px', borderRadius: '3px', marginBottom: '4px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
  },
  userAvatar: (isAdmin) => ({
    width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
    background: isAdmin ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${isAdmin ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Cinzel', fontSize: '11px',
    color: isAdmin ? '#c8943a' : 'rgba(226,213,187,0.4)',
  }),
  userName: {
    flex: 1, fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: '#e2d5bb',
  },
  adminBadge: {
    fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em',
    color: '#c8943a', background: 'rgba(200,148,58,0.1)',
    border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px',
    padding: '2px 6px',
  },
  deleteBtn: {
    background: 'rgba(139,32,53,0.15)', border: '1px solid rgba(139,32,53,0.3)',
    borderRadius: '3px', cursor: 'pointer', padding: '4px 10px',
    fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em',
    color: 'rgba(224,112,112,0.7)', transition: 'all 0.2s',
  },
  newUserForm: {
    padding: '14px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(200,148,58,0.15)', borderRadius: '3px',
    marginTop: '12px',
  },
  formTitle: {
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.2em',
    color: 'rgba(200,148,58,0.4)', marginBottom: '10px',
  },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px',
    color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif',
    padding: '7px 10px', outline: 'none', marginBottom: '8px',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  createBtn: {
    padding: '7px 16px', background: 'linear-gradient(135deg, #c8943a, #a07030)',
    border: 'none', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em',
    color: '#07080e', whiteSpace: 'nowrap',
  },
  error: {
    padding: '8px 12px', background: 'rgba(139,32,53,0.2)',
    border: '1px solid rgba(139,32,53,0.4)', borderRadius: '2px',
    color: '#e07070', fontFamily: 'Crimson Pro, serif', fontSize: '13px',
    marginBottom: '10px',
  },
  success: {
    padding: '8px 12px', background: 'rgba(58,196,139,0.1)',
    border: '1px solid rgba(58,196,139,0.3)', borderRadius: '2px',
    color: '#6edbb0', fontFamily: 'Crimson Pro, serif', fontSize: '13px',
    marginBottom: '10px',
  },
};

export default function AdminPanel({ currentUser, onClose }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const [users, setUsers] = useState([]);
  const [regOpen, setRegOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  // Vault
  const [vault, setVault] = useState([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [demoSeeded, setDemoSeeded] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  // Backup
  const [backupInfo, setBackupInfo]       = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError]     = useState('');
  // AI settings
  const [aiEnabled, setAiEnabled]       = useState(false);
  const [aiKeySet, setAiKeySet]         = useState(false);
  const [aiKeyMasked, setAiKeyMasked]   = useState('');
  const [aiKeyInput, setAiKeyInput]     = useState('');
  const [aiTesting, setAiTesting]       = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null); // { ok: bool, msg: string }
  const [aiSaving, setAiSaving]         = useState(false);
  const [aiWarning, setAiWarning]       = useState('');
  // Password change
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [tab, setTab] = useState('users'); // 'users' | 'vault' | 'demo' | 'password'

  const loadData = async () => {
    try {
      const [usersRes, settingsRes, demoRes, aiRes, backupRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/settings'),
        api.get('/admin/demo/status'),
        api.get('/admin/ai/settings'),
        api.get('/admin/backup/info'),
      ]);
      setUsers(usersRes.data);
      setRegOpen(settingsRes.data.registration_open);
      setDemoSeeded(demoRes.data.demo_seeded);
      setAiEnabled(aiRes.data.ai_enabled);
      setAiKeySet(aiRes.data.ai_key_set);
      setAiKeyMasked(aiRes.data.ai_key_masked);
      setBackupInfo(backupRes.data);
    } catch (err) {
      setError('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const loadVault = async () => {
    setVaultLoading(true);
    try {
      const res = await api.get('/snapshots');
      setVault(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError('Failed to load vault');
      setVault([]);
    } finally {
      setVaultLoading(false);
    }
  };

  useEffect(() => { loadData(); loadVault(); }, []);

  const handleRestore = async (folderId, snapshotId, savedAt, campaignTitle) => {
    if (!window.confirm(`Restore "${campaignTitle}" to snapshot from ${new Date(savedAt).toLocaleString()}?\n\nExisting notes will be restored. Notes created after the snapshot will be kept.`)) return;
    setRestoring(snapshotId);
    setError('');
    try {
      await api.post(`/snapshots/${folderId}/restore/${snapshotId}`);
      setSuccess(`"${campaignTitle}" restored successfully.`);
      loadVault();
    } catch (err) {
      setError(err.response?.data?.error || 'Restore failed.');
    }
    setRestoring(null);
  };

  const handleGenerateDemo = async () => {
    if (!window.confirm('Generate demo data? This will create 4 demo users, 2 campaigns, ~40 notes, and 3 journal sessions.')) return;
    setDemoLoading(true); setError(''); setSuccess('');
    try {
      await api.post('/admin/demo/generate');
      setDemoSeeded(true);
      setSuccess('Demo data generated! Refresh the page to see it.');
    } catch (err) { setError(err.response?.data?.error || 'Failed to generate demo'); }
    setDemoLoading(false);
  };

  const handleWipeDemo = async () => {
    if (!window.confirm('Wipe all demo data? This permanently deletes all demo users, notes, and journal entries.')) return;
    setDemoLoading(true); setError(''); setSuccess('');
    try {
      await api.delete('/admin/demo/wipe');
      setDemoSeeded(false);
      setSuccess('Demo data wiped successfully.');
    } catch (err) { setError(err.response?.data?.error || 'Failed to wipe demo'); }
    setDemoLoading(false);
  };

  const handleChangePassword = async () => {
    setError(''); setSuccess('');
    if (!curPwd || !newPwd) return setError('Both fields are required');
    if (newPwd.length < 6) return setError('New password must be at least 6 characters');
    try {
      await api.post('/admin/change-password', { current_password: curPwd, new_password: newPwd });
      setSuccess('Password changed successfully. The security warning will be gone on next login.');
      setCurPwd(''); setNewPwd('');
    } catch (err) { setError(err.response?.data?.error || 'Failed to change password'); }
  };

  const handleToggleReg = async () => {
    try {
      const res = await api.post('/admin/settings/registration', { open: !regOpen });
      setRegOpen(res.data.registration_open);
    } catch (err) {
      setError('Failed to update setting');
    }
  };

  const handleCreateUser = async () => {
    setError(''); setSuccess('');
    try {
      await api.post('/admin/users', {
        username: newUsername,
        password: newPassword,
        is_admin: newIsAdmin,
      });
      setSuccess(`Account created for ${newUsername}`);
      setNewUsername(''); setNewPassword(''); setNewIsAdmin(false);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!window.confirm(`Remove ${username} from the party? This deletes all their notes.`)) return;
    try {
      await api.delete(`/admin/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setSuccess(`${username} has been removed`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  return (
    <div style={{ ...S.overlay, padding: isMobile ? 0 : '24px' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={isMobile ? {
        width: '100%', height: '100%', maxHeight: '100%',
        background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
        display: 'flex', flexDirection: 'column', borderRadius: 0, border: 'none',
        boxShadow: 'none', paddingTop: 'env(safe-area-inset-top)',
      } : { ...S.panel, maxWidth: tab === 'vault' ? '680px' : '560px' }}>
        <div style={S.header}>
          <span style={S.title}>⚔ ADMIN PANEL</span>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { id: 'users', label: 'PARTY' },
              { id: 'vault', label: 'VAULT' },
              { id: 'demo',  label: 'DEMO' },
              { id: 'ai',    label: 'AI' },
              { id: 'backup', label: 'BACKUP' },
              { id: 'password', label: 'PWD' },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em',
                padding: isMobile ? '6px 10px' : '4px 12px', minHeight: isMobile ? '36px' : 'auto',
                borderRadius: '3px', cursor: 'pointer',
                background: tab === t.id ? 'rgba(200,148,58,0.15)' : 'transparent',
                border: `1px solid ${tab === t.id ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: tab === t.id ? '#c8943a' : 'rgba(226,213,187,0.3)',
              }}>
                {t.label}
              </button>
            ))}
          </div>
          <button style={S.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={S.body}>
          {error && <div style={S.error}>{error}</div>}
          {success && <div style={S.success}>{success}</div>}

          {tab === 'users' && (<>
            {/* Registration toggle */}
            <div style={S.section}>
              <div style={S.sectionTitle}>Registration</div>
              <div style={S.toggleRow}>
                <div>
                  <div style={S.toggleLabel}>Open Registration</div>
                  <div style={S.toggleSub}>
                    {regOpen ? 'Anyone can create an account' : 'Only admins can create accounts'}
                  </div>
                </div>
                <div style={S.toggle(regOpen)} onClick={handleToggleReg}>
                  <div style={S.toggleDot(regOpen)} />
                </div>
              </div>
            </div>

            {/* User list */}
            <div style={S.section}>
              <div style={S.sectionTitle}>Party Members ({users.length})</div>
              {loading ? (
                <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.3)', fontSize: '14px' }}>Loading...</div>
              ) : (
                users.map(u => (
                  <div key={u.id} style={S.userRow}>
                    <div style={S.userAvatar(u.is_admin)}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div style={S.userName}>{u.username}</div>
                    {!!u.is_admin ? <span style={S.adminBadge}>ADMIN</span> : null}
                    {u.id !== currentUser.id && (
                      <button
                        style={S.deleteBtn}
                        onClick={() => handleDeleteUser(u.id, u.username)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,32,53,0.3)'; e.currentTarget.style.color = '#e07070'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,32,53,0.15)'; e.currentTarget.style.color = 'rgba(224,112,112,0.7)'; }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))
              )}
              <div style={S.newUserForm}>
                <div style={S.formTitle}>CREATE NEW ACCOUNT</div>
                <input style={S.input} placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                <input style={S.input} type="password" placeholder="Password (min 6 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <div style={S.row}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)' }}>
                    <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
                    ADMIN
                  </label>
                  <div style={{ flex: 1 }} />
                  <button style={S.createBtn} onClick={handleCreateUser}>Create Account</button>
                </div>
              </div>
            </div>
          </>)}

          {tab === 'demo' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Demo Environment</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)', lineHeight: '1.6', marginBottom: '16px' }}>
                Generates a full demo dataset: 4 users, 2 campaigns, ~40 notes across all categories, 3 journal sessions with realistic multi-author entries, and a complete connection graph. All demo content is flagged and can be wiped cleanly without touching real data.
              </div>
              <div style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${demoSeeded ? 'rgba(58,196,139,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '3px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: demoSeeded ? 'rgba(58,196,139,0.8)' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', color: demoSeeded ? 'rgba(58,196,139,0.8)' : 'rgba(226,213,187,0.4)', marginBottom: '2px' }}>
                    {demoSeeded ? 'DEMO DATA ACTIVE' : 'NO DEMO DATA'}
                  </div>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.3)' }}>
                    {demoSeeded ? 'Demo users and content are currently loaded.' : 'No demo content has been generated yet.'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!demoSeeded && (
                  <button onClick={handleGenerateDemo} disabled={demoLoading}
                    style={{ flex: 1, padding: '10px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '3px', cursor: 'pointer', color: '#c8943a' }}>
                    {demoLoading ? 'GENERATING...' : '⚗ GENERATE DEMO DATA'}
                  </button>
                )}
                {demoSeeded && (
                  <button onClick={handleWipeDemo} disabled={demoLoading}
                    style={{ flex: 1, padding: '10px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', background: 'rgba(139,32,53,0.15)', border: '1px solid rgba(139,32,53,0.4)', borderRadius: '3px', cursor: 'pointer', color: 'rgba(224,112,112,0.8)' }}>
                    {demoLoading ? 'WIPING...' : '✕ WIPE DEMO DATA'}
                  </button>
                )}
              </div>
              <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(200,148,58,0.04)', border: '1px solid rgba(200,148,58,0.1)', borderRadius: '3px' }}>
                <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>DEMO ACCOUNTS</div>
                {[
                  { user: 'DungeonMaster', pw: 'demo1234', role: 'Admin (demo)' },
                  { user: 'Sable',         pw: 'demo1234', role: 'Player' },
                  { user: 'Brennan',       pw: 'demo1234', role: 'Player' },
                  { user: 'Lira',          pw: 'demo1234', role: 'Player' },
                ].map(({ user, pw, role }) => (
                  <div key={user} style={{ display: 'flex', gap: '12px', fontFamily: 'monospace', fontSize: '12px', color: 'rgba(226,213,187,0.5)', marginBottom: '4px' }}>
                    <span style={{ color: 'rgba(200,148,58,0.7)', width: '120px' }}>{user}</span>
                    <span>{pw}</span>
                    <span style={{ color: 'rgba(226,213,187,0.3)', marginLeft: '8px' }}>{role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>AI Features</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)', lineHeight: '1.6', marginBottom: '16px' }}>
                AI features use the <strong style={{ color: 'rgba(200,148,58,0.7)' }}>Anthropic API</strong> and are billed per use to your API account — not included in Claude Pro. Typical usage for a weekly group costs well under $1/month. You are responsible for all API costs incurred.
              </div>

              {/* Enable toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.6)', marginBottom: '3px' }}>AI FEATURES</div>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: aiEnabled ? 'rgba(200,148,58,0.8)' : 'rgba(226,213,187,0.3)' }}>
                    {aiEnabled ? 'Enabled — AI features visible to all users' : 'Disabled — requires a valid API key to enable'}
                  </div>
                </div>
                <div style={S.toggle(aiEnabled)} onClick={async () => {
                  setAiWarning('');
                  setAiSaving(true);
                  try {
                    const res = await api.post('/admin/ai/settings', { ai_enabled: !aiEnabled });
                    setAiEnabled(res.data.ai_enabled);
                    setAiKeySet(res.data.ai_key_set);
                    setAiKeyMasked(res.data.ai_key_masked);
                    if (res.data.warning) setAiWarning(res.data.warning);
                  } finally { setAiSaving(false); }
                }}>
                  <div style={S.toggleDot(aiEnabled)} />
                </div>
              </div>

              {/* API Key section */}
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.4)', marginBottom: '8px' }}>
                ANTHROPIC API KEY
              </div>

              {aiKeySet && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px 12px', background: 'rgba(80,180,100,0.06)', border: '1px solid rgba(80,180,100,0.2)', borderRadius: '3px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgba(226,213,187,0.5)', flex: 1, letterSpacing: '0.05em' }}>{aiKeyMasked}</span>
                  <button onClick={async () => {
                    if (!window.confirm('Remove the saved API key? This will also disable AI features.')) return;
                    const res = await api.post('/admin/ai/clear-key');
                    setAiEnabled(false); setAiKeySet(false); setAiKeyMasked(''); setAiTestResult(null);
                  }} style={{ background: 'none', border: '1px solid rgba(200,80,80,0.3)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,80,80,0.6)', padding: '3px 8px' }}>
                    REMOVE
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.03em' }}
                  type="password"
                  placeholder={aiKeySet ? 'Enter new key to replace existing...' : 'sk-ant-api03-...'}
                  value={aiKeyInput}
                  onChange={e => { setAiKeyInput(e.target.value); setAiTestResult(null); setAiWarning(''); }}
                />
                <button
                  onClick={async () => {
                    if (!aiKeyInput.trim()) return;
                    setAiSaving(true); setAiWarning(''); setAiTestResult(null);
                    try {
                      const res = await api.post('/admin/ai/settings', { ai_api_key: aiKeyInput.trim(), ai_enabled: aiEnabled });
                      setAiEnabled(res.data.ai_enabled);
                      setAiKeySet(res.data.ai_key_set);
                      setAiKeyMasked(res.data.ai_key_masked);
                      setAiKeyInput('');
                      if (res.data.warning) setAiWarning(res.data.warning);
                    } finally { setAiSaving(false); }
                  }}
                  style={{ padding: '8px 14px', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: '#c8943a', whiteSpace: 'nowrap' }}>
                  {aiSaving ? 'SAVING...' : 'SAVE KEY'}
                </button>
              </div>

              {/* Test key button */}
              {aiKeySet && (
                <button
                  onClick={async () => {
                    setAiTesting(true); setAiTestResult(null);
                    try {
                      await api.post('/admin/ai/test-key');
                      setAiTestResult({ ok: true, msg: 'API key is valid and working.' });
                    } catch (e) {
                      setAiTestResult({ ok: false, msg: e.response?.data?.error || 'Test failed.' });
                    } finally { setAiTesting(false); }
                  }}
                  style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.4)', marginBottom: '10px' }}>
                  {aiTesting ? 'TESTING...' : '⚡ TEST KEY'}
                </button>
              )}

              {aiTestResult && (
                <div style={{ padding: '8px 12px', borderRadius: '3px', marginBottom: '10px', background: aiTestResult.ok ? 'rgba(80,180,100,0.08)' : 'rgba(200,80,80,0.08)', border: `1px solid ${aiTestResult.ok ? 'rgba(80,180,100,0.25)' : 'rgba(200,80,80,0.25)'}`, fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: aiTestResult.ok ? 'rgba(80,200,100,0.9)' : 'rgba(220,100,100,0.9)' }}>
                  {aiTestResult.ok ? '✓ ' : '✕ '}{aiTestResult.msg}
                </div>
              )}

              {aiWarning && (
                <div style={{ padding: '8px 12px', borderRadius: '3px', marginBottom: '10px', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(200,148,58,0.8)' }}>
                  ⚠ {aiWarning}
                </div>
              )}

              <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.25)', marginBottom: '6px' }}>SECURITY NOTICE</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.3)', lineHeight: '1.6' }}>
                  Your API key is stored in the database on your server only. It is never included in source code, config files, or GitHub. Only the last 4 characters are ever shown in this panel.
                </div>
              </div>
            </div>
          )}

          {tab === 'backup' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Database Backup</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)', lineHeight: '1.6', marginBottom: '20px' }}>
                Downloads a complete copy of the database — all notes, journal entries, recaps, connections, users, and snapshots. Sensitive data (API key) is automatically removed from the download.
              </div>

              {/* DB info */}
              {backupInfo && (
                <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                  {[
                    { label: 'DATABASE SIZE', value: `${backupInfo.size_kb} KB` },
                    { label: 'LAST MODIFIED', value: backupInfo.last_modified ? new Date(backupInfo.last_modified).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown' },
                  ].map(item => (
                    <div key={item.label} style={{ flex: 1, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                      <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.3)', marginBottom: '5px' }}>{item.label}</div>
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.7)' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {backupError && (
                <div style={{ padding: '8px 12px', borderRadius: '3px', marginBottom: '14px', background: 'rgba(200,80,80,0.08)', border: '1px solid rgba(200,80,80,0.25)', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(220,100,100,0.9)' }}>
                  {backupError}
                </div>
              )}

              <button
                onClick={async () => {
                  setBackupLoading(true);
                  setBackupError('');
                  try {
                    const res = await api.get('/admin/backup/download', { responseType: 'blob' });
                    const date = new Date().toISOString().slice(0, 10);
                    const url  = URL.createObjectURL(res.data);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = `chronicler_backup_${date}.db`;
                    a.click();
                    URL.revokeObjectURL(url);
                    // Refresh info
                    const info = await api.get('/admin/backup/info');
                    setBackupInfo(info.data);
                  } catch (e) {
                    setBackupError('Download failed. Try again.');
                  } finally {
                    setBackupLoading(false);
                  }
                }}
                disabled={backupLoading}
                style={{ padding: '10px 22px', background: backupLoading ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, rgba(200,148,58,0.25), rgba(200,148,58,0.1))', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '3px', cursor: backupLoading ? 'not-allowed' : 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: backupLoading ? 'rgba(226,213,187,0.3)' : '#c8943a' }}>
                {backupLoading ? '⏳ PREPARING...' : '⬇ DOWNLOAD BACKUP'}
              </button>

              <div style={{ marginTop: '20px', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.25)', marginBottom: '6px' }}>WHAT IS INCLUDED</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.3)', lineHeight: '1.7' }}>
                  All notes, folders, journal sessions &amp; entries, recaps, graph connections, user accounts, tags, snapshots, and app settings. The Anthropic API key is stripped before download. The file is a standard SQLite database and can be opened with any SQLite viewer.
                </div>
              </div>
            </div>
          )}

          {tab === 'password' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Change Password</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)', lineHeight: '1.6', marginBottom: '16px' }}>
                If you are using the default admin/admin credentials, change your password here immediately.
              </div>
              <input style={{ ...S.input, marginBottom: '8px' }} type="password" placeholder="Current password" value={curPwd} onChange={e => setCurPwd(e.target.value)} />
              <input style={{ ...S.input, marginBottom: '14px' }} type="password" placeholder="New password (min 6 characters)" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              <button onClick={handleChangePassword}
                style={{ padding: '9px 20px', background: 'linear-gradient(135deg, #c8943a, #a07030)', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: '#07080e' }}>
                CHANGE PASSWORD
              </button>
            </div>
          )}

          {tab === 'vault' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Campaign Snapshot Vault</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.3)', marginBottom: '16px', lineHeight: '1.5' }}>
                All campaign snapshots across every party member. Restore any campaign to a previous state. Non-destructive — notes created after the snapshot are preserved.
              </div>

              {vaultLoading ? (
                <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.3)', fontSize: '14px', padding: '20px 0' }}>Loading vault...</div>
              ) : vault.length === 0 ? (
                <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.2)', fontSize: '14px', textAlign: 'center', padding: '32px 0' }}>
                  No snapshots saved yet. Hover a campaign folder in the sidebar and click 📷 to create one.
                </div>
              ) : (
                vault.map(campaign => {
                  const isExpanded = expandedCampaign === campaign.id;
                  const latest = campaign.snapshots[0];
                  return (
                    <div key={campaign.id} style={{ marginBottom: '8px', border: `1px solid ${isExpanded ? 'rgba(200,148,58,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '4px', overflow: 'hidden', transition: 'border-color 0.15s' }}>

                      {/* Campaign header row */}
                      <div
                        onClick={() => setExpandedCampaign(isExpanded ? null : campaign.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: isExpanded ? 'rgba(200,148,58,0.06)' : 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                      >
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>📁</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.08em', color: '#e2d5bb', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {campaign.title}
                          </div>
                          <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.3)' }}>
                            {campaign.owner} · {campaign.snapshots.length} snapshot{campaign.snapshots.length !== 1 ? 's' : ''}
                            {latest && <span style={{ marginLeft: '8px', color: 'rgba(200,148,58,0.4)' }}>Last: {new Date(latest.saved_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                          </div>
                        </div>
                        {campaign.snapshots.length === 0 && (
                          <span style={{ fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(226,213,187,0.2)', letterSpacing: '0.1em' }}>NO SNAPSHOTS</span>
                        )}
                        <span style={{ color: 'rgba(200,148,58,0.4)', fontSize: '10px', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                      </div>

                      {/* Expanded snapshots */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          {campaign.snapshots.length === 0 ? (
                            <div style={{ padding: '14px 16px', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.25)' }}>
                              No snapshots for this campaign yet.
                            </div>
                          ) : (
                            campaign.snapshots.map((s, i) => (
                              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px', borderBottom: i < campaign.snapshots.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: i === 0 ? 'rgba(58,196,139,0.03)' : 'transparent' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.8)' }}>
                                      {new Date(s.saved_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {i === 0 && (
                                      <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(58,196,139,0.6)', background: 'rgba(58,196,139,0.08)', border: '1px solid rgba(58,196,139,0.15)', borderRadius: '10px', padding: '1px 6px' }}>LATEST</span>
                                    )}
                                  </div>
                                  <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.25)', display: 'flex', gap: '12px' }}>
                                    <span>by {s.saved_by}</span>
                                    <span>{s.note_count} note{s.note_count !== 1 ? 's' : ''} captured</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleRestore(campaign.id, s.id, s.saved_at, campaign.title)}
                                  disabled={!!restoring}
                                  style={{ padding: '6px 14px', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: '3px', cursor: restoring ? 'default' : 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: restoring === s.id ? 'rgba(200,148,58,0.3)' : 'rgba(200,148,58,0.7)', flexShrink: 0, opacity: restoring && restoring !== s.id ? 0.4 : 1 }}
                                  onMouseEnter={e => { if (!restoring) e.currentTarget.style.background = 'rgba(200,148,58,0.15)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(200,148,58,0.08)'; }}
                                >
                                  {restoring === s.id ? 'Restoring...' : 'Restore'}
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
