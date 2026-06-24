import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    overflowY: 'auto',
  },
  panel: {
    width: 'min(680px, calc(100vw - 48px))',
    height: 'min(85vh, 820px)',
    maxHeight: 'min(85vh, 820px)',
    flexShrink: 0,
    background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
    border: '1px solid rgba(200,148,58,0.25)', borderRadius: '4px',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 0 60px rgba(0,0,0,0.9)',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 24px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column', gap: '12px',
    flexShrink: 0,
  },
  headerTopRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  },
  tabsRow: {
    display: 'flex', gap: '4px', flexWrap: 'wrap', paddingBottom: '14px',
  },
  title: {
    fontFamily: 'var(--ch-font-display)', fontSize: '14px', letterSpacing: '0.2em',
    color: 'var(--ch-accent)',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'rgba(226,213,187,0.3)', fontSize: '20px', lineHeight: 1,
    padding: '0 4px',
  },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  section: { marginBottom: '28px' },
  sectionTitle: {
    fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.25em',
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
    fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'var(--ch-text-primary)',
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
    fontFamily: 'var(--ch-font-display)', fontSize: '11px',
    color: isAdmin ? '#c8943a' : 'rgba(226,213,187,0.4)',
  }),
  userName: {
    flex: 1, fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'var(--ch-text-primary)',
  },
  adminBadge: {
    fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.15em',
    color: 'var(--ch-accent)', background: 'rgba(200,148,58,0.1)',
    border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px',
    padding: '2px 6px',
  },
  deleteBtn: {
    background: 'rgba(139,32,53,0.15)', border: '1px solid rgba(139,32,53,0.3)',
    borderRadius: '3px', cursor: 'pointer', padding: '4px 10px',
    fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em',
    color: 'rgba(224,112,112,0.7)', transition: 'all 0.2s',
  },
  /** Opens inline form to set a user password without the current password (admin only). */
  setPwdBtn: {
    background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)',
    borderRadius: '3px', cursor: 'pointer', padding: '4px 10px',
    fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em',
    color: 'rgba(200,148,58,0.8)', transition: 'all 0.2s', flexShrink: 0,
  },
  newUserForm: {
    padding: '14px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(200,148,58,0.15)', borderRadius: '3px',
    marginTop: '12px',
  },
  formTitle: {
    fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.2em',
    color: 'rgba(200,148,58,0.4)', marginBottom: '10px',
  },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px',
    color: 'var(--ch-text-primary)', fontSize: '14px', fontFamily: 'Crimson Pro, serif',
    padding: '7px 10px', outline: 'none', marginBottom: '8px',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  createBtn: {
    padding: '7px 16px', background: 'linear-gradient(135deg, #c8943a, #a07030)',
    border: 'none', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em',
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

/**
 * Full-screen admin settings modal: users (including set-password for any party member), vault, demo, AI, backup, Chronicler JSON import, password.
 * @param {{ id: number, username: string, is_admin?: boolean }} currentUser - Logged-in admin
 * @param {() => void} onClose - Closes the overlay
 * @param {() => void} [onChroniclerImportDone] - Optional; invoked after a successful JSON tree import to refresh the main app’s note list
 */
const AdminPanel = forwardRef(function AdminPanel(
  { currentUser, onClose, onChroniclerImportDone, initialTab = 'users', tutorialExpandVault = false, tutorialRefs = null },
  ref,
) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const tabsRowRef = useRef(null);
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
  const [jsonImportBusy, setJsonImportBusy] = useState(false);
  const [jsonImportMsg, setJsonImportMsg]   = useState('');
  const [jsonImportErr, setJsonImportErr]   = useState('');
  const [jsonImportParentId, setJsonImportParentId] = useState('');
  // AI settings
  const [aiEnabled, setAiEnabled]       = useState(false);
  const [aiKeySet, setAiKeySet]         = useState(false);
  const [aiKeyMasked, setAiKeyMasked]   = useState('');
  const [aiKeyInput, setAiKeyInput]     = useState('');
  const [aiTesting, setAiTesting]       = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null); // { ok: bool, msg: string }
  const [aiSaving, setAiSaving]         = useState(false);
  const [aiWarning, setAiWarning]       = useState('');
  /** True when an Anthropic API key is stored (session recaps). */
  const [recapGenerationReady, setRecapGenerationReady] = useState(false);
  // Password change
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [tab, setTab] = useState('users'); // 'users' | 'vault' | 'demo' | 'password'
  const [updateCheck, setUpdateCheck] = useState(null); // { updateAvailable, currentVersion, latestVersion, latestTag }
  /** When set, inline form under that user sets a new password via PUT /admin/users/:id/password. */
  const [editingPwdUserId, setEditingPwdUserId] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetPwd2, setResetPwd2] = useState('');
  const [forcePwdNextLogin, setForcePwdNextLogin] = useState(false);

  /**
   * Applies a full /admin/ai/settings (or clear-key) JSON payload into React state.
   * @param {Record<string, unknown>} d
   */
  const applyAiSettingsResponse = (d) => {
    if (!d || typeof d !== 'object') return;
    if ('ai_enabled' in d) setAiEnabled(!!d.ai_enabled);
    if ('ai_key_set' in d) setAiKeySet(!!d.ai_key_set);
    if ('ai_key_masked' in d) setAiKeyMasked(d.ai_key_masked || '');
    if ('recap_generation_ready' in d) setRecapGenerationReady(!!d.recap_generation_ready);
  };

  const loadData = async () => {
    try {
      const [usersRes, settingsRes, demoRes, aiRes, backupRes, updateRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/settings'),
        api.get('/admin/demo/status'),
        api.get('/admin/ai/settings'),
        api.get('/admin/backup/info'),
        api.get('/admin/update-check').catch(() => ({ data: null })),
      ]);
      setUsers(usersRes.data);
      setRegOpen(settingsRes.data.registration_open);
      setDemoSeeded(demoRes.data.demo_seeded);
      applyAiSettingsResponse(aiRes.data);
      setBackupInfo(backupRes.data);
      if (updateRes && updateRes.data) setUpdateCheck(updateRes.data);
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

  useEffect(() => {
    setTab(initialTab || 'users');
    loadData();
    loadVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useImperativeHandle(ref, () => ({
    /** Sets the visible admin tab (used by the tutorial). */
    setTab: (nextTab) => setTab(nextTab),
    /** Focuses the tab strip (best-effort). */
    focusTabs: () => tabsRowRef.current?.focus?.(),
    /** Expands the first campaign row in the vault tree (tutorial). */
    expandFirstVault: () => {
      if (vault.length > 0) setExpandedCampaign(vault[0].id);
    },
  }), [vault]);

  /** Tutorial: auto-expand the first vault campaign when the tree should be visible. */
  useEffect(() => {
    if (!tutorialExpandVault || tab !== 'vault' || vaultLoading || vault.length === 0) return;
    setExpandedCampaign(vault[0].id);
  }, [tutorialExpandVault, tab, vaultLoading, vault]);

  /**
   * Restores a campaign folder to a saved snapshot (admin vault). snapshotLabel is optional UI text only.
   */
  const handleRestore = async (folderId, snapshotId, savedAt, campaignTitle, snapshotLabel) => {
    const labelLine = snapshotLabel ? `\n\nLabel: "${snapshotLabel}"` : '';
    if (!window.confirm(`Restore "${campaignTitle}" to snapshot from ${new Date(savedAt).toLocaleString()}?${labelLine}\n\nExisting notes will be restored. Notes created after the snapshot will be kept.`)) return;
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
    if (!window.confirm('Generate demo data? This creates 2 sample campaigns (~40 notes, journal sessions) owned by you. All current users become DMs on those campaigns; only admins can edit demo content. Refresh the page after generating.')) return;
    setDemoLoading(true); setError(''); setSuccess('');
    try {
      await api.post('/admin/demo/generate');
      setDemoSeeded(true);
      setSuccess('Demo data generated! Refresh the page to see it.');
    } catch (err) { setError(err.response?.data?.error || 'Failed to generate demo'); }
    setDemoLoading(false);
  };

  const handleWipeDemo = async () => {
    if (!window.confirm('Wipe all demo data? This permanently deletes demo campaigns, notes, and journal sessions. Your real user accounts are not removed.')) return;
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

  /**
   * Sets another user’s password (admin). Optionally forces them to change password on next login.
   * @param {number} userId
   */
  const handleSetUserPassword = async (userId) => {
    setError(''); setSuccess('');
    if (!resetPwd || resetPwd.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (resetPwd !== resetPwd2) {
      setError('Passwords do not match');
      return;
    }
    try {
      await api.put(`/admin/users/${userId}/password`, {
        new_password: resetPwd,
        force_password_change: forcePwdNextLogin,
      });
      setSuccess('Password updated.');
      setEditingPwdUserId(null);
      setResetPwd('');
      setResetPwd2('');
      setForcePwdNextLogin(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set password');
    }
  };

  return (
    <div ref={tutorialRefs?.shell || null} style={{ ...S.overlay, padding: isMobile ? 0 : '24px' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={isMobile ? {
        width: '100%', height: '100%', maxHeight: '100%',
        background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
        display: 'flex', flexDirection: 'column', borderRadius: 0, border: 'none',
        boxShadow: 'none', paddingTop: 'env(safe-area-inset-top)',
      } : { ...S.panel }}>
        <div style={S.header}>
          <div style={S.headerTopRow}>
            <span style={S.title}>⚔ ADMIN PANEL</span>
            <button style={S.closeBtn} onClick={onClose}>×</button>
          </div>
          <div ref={tabsRowRef} style={S.tabsRow}>
            {[
              { id: 'users', label: 'PARTY' },
              { id: 'vault', label: 'VAULT' },
              { id: 'demo',  label: 'DEMO' },
              { id: 'ai',    label: 'AI' },
              { id: 'backup', label: 'BACKUP' },
              { id: 'password', label: 'PWD' },
            ].map(t => (
              <button key={t.id} ref={tutorialRefs?.[`tab_${t.id}`] || null} onClick={() => setTab(t.id)} style={{
                fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.15em',
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
        </div>

        {updateCheck?.updateAvailable && (
          <div style={{
            padding: '10px 20px', margin: '0 24px 0', flexShrink: 0,
            background: 'rgba(200,148,58,0.12)', border: '1px solid rgba(200,148,58,0.35)',
            borderRadius: '3px', fontFamily: 'Crimson Pro, serif', fontSize: '13px',
            color: 'var(--ch-text-primary)',
          }}>
            A new version ({updateCheck.latestTag || updateCheck.latestVersion}) is available. To update on the server: <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '2px' }}>git pull origin main && ./deploy.sh</code>. Your data is not deleted.
          </div>
        )}

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
                users.map((u) => (
                  <div key={u.id}>
                    <div style={S.userRow}>
                      <div style={S.userAvatar(u.is_admin)}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <div style={S.userName}>{u.username}</div>
                      {!!u.is_admin ? <span style={S.adminBadge}>ADMIN</span> : null}
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          style={{
                            ...S.setPwdBtn,
                            background: editingPwdUserId === u.id ? 'rgba(200,148,58,0.2)' : S.setPwdBtn.background,
                          }}
                          onClick={() => {
                            if (editingPwdUserId === u.id) {
                              setEditingPwdUserId(null);
                              setResetPwd('');
                              setResetPwd2('');
                              setForcePwdNextLogin(false);
                            } else {
                              setEditingPwdUserId(u.id);
                              setResetPwd('');
                              setResetPwd2('');
                              setForcePwdNextLogin(false);
                            }
                          }}
                        >
                          {editingPwdUserId === u.id ? 'Cancel' : 'Set password'}
                        </button>
                        {u.id !== currentUser.id && (
                          <button
                            type="button"
                            style={S.deleteBtn}
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,32,53,0.3)'; e.currentTarget.style.color = '#e07070'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,32,53,0.15)'; e.currentTarget.style.color = 'rgba(224,112,112,0.7)'; }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {editingPwdUserId === u.id && (
                      <div style={{
                        marginBottom: '8px',
                        padding: '12px 14px',
                        background: 'rgba(0,0,0,0.22)',
                        borderRadius: '3px',
                        border: '1px solid var(--ch-border)',
                      }}
                      >
                        <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.45)', marginBottom: '8px' }}>
                          NEW PASSWORD FOR {u.username.toUpperCase()}
                        </div>
                        <input
                          style={S.input}
                          type="password"
                          placeholder="New password (min 6 characters)"
                          value={resetPwd}
                          onChange={(e) => setResetPwd(e.target.value)}
                          autoComplete="new-password"
                        />
                        <input
                          style={{ ...S.input, marginTop: '8px' }}
                          type="password"
                          placeholder="Confirm password"
                          value={resetPwd2}
                          onChange={(e) => setResetPwd2(e.target.value)}
                          autoComplete="new-password"
                        />
                        <label style={{
                          display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer',
                          fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em', color: 'var(--ch-text-primary-55)',
                        }}
                        >
                          <input
                            type="checkbox"
                            checked={forcePwdNextLogin}
                            onChange={(e) => setForcePwdNextLogin(e.target.checked)}
                          />
                          Force password change on next login
                        </label>
                        <button
                          type="button"
                          style={{ ...S.createBtn, marginTop: '12px', width: '100%' }}
                          onClick={() => handleSetUserPassword(u.id)}
                        >
                          Save new password
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
              <div style={S.newUserForm}>
                <div style={S.formTitle}>CREATE NEW ACCOUNT</div>
                <input style={S.input} placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                <input style={S.input} type="password" placeholder="Password (min 6 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <div style={S.row}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)' }}>
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
                Inserts two sample campaigns (NPCs, locations, factions, journal sessions, connections, DM-only examples) owned by <strong style={{ color: 'rgba(200,148,58,0.75)' }}>you</strong> — no separate “demo” logins. Every existing user is granted DM on those roots so they see the full tree; new sign-ups are synced the same way. <strong style={{ color: 'rgba(200,148,58,0.75)' }}>Only admins</strong> can edit demo content; everyone else gets a read-only showcase. Wipe removes only flagged demo notes and sessions, not real users.
              </div>
              <div style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${demoSeeded ? 'rgba(58,196,139,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '3px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: demoSeeded ? 'rgba(58,196,139,0.8)' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', color: demoSeeded ? 'rgba(58,196,139,0.8)' : 'rgba(226,213,187,0.4)', marginBottom: '2px' }}>
                    {demoSeeded ? 'DEMO DATA ACTIVE' : 'NO DEMO DATA'}
                  </div>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.3)' }}>
                    {demoSeeded ? 'Shared demo campaigns are loaded; players can open Tutorial or hide demo folders from the user (⋯) menu.' : 'No demo content has been generated yet.'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!demoSeeded && (
                  <button onClick={handleGenerateDemo} disabled={demoLoading}
                    style={{ flex: 1, padding: '10px', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '3px', cursor: 'pointer', color: 'var(--ch-accent)' }}>
                    {demoLoading ? 'GENERATING...' : '⚗ GENERATE DEMO DATA'}
                  </button>
                )}
                {demoSeeded && (
                  <button onClick={handleWipeDemo} disabled={demoLoading}
                    style={{ flex: 1, padding: '10px', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', background: 'rgba(139,32,53,0.15)', border: '1px solid rgba(139,32,53,0.4)', borderRadius: '3px', cursor: 'pointer', color: 'rgba(224,112,112,0.8)' }}>
                    {demoLoading ? 'WIPING...' : '✕ WIPE DEMO DATA'}
                  </button>
                )}
              </div>
              <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(200,148,58,0.04)', border: '1px solid rgba(200,148,58,0.1)', borderRadius: '3px' }}>
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '8px' }}>HOW DEMO WORKS</div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.45)', lineHeight: 1.55 }}>
                  <li>Party members sign in with their <strong style={{ color: 'rgba(200,148,58,0.65)' }}>normal</strong> accounts — there are no extra demo passwords.</li>
                  <li>After you generate, ask users to refresh once so the sidebar and <strong style={{ color: 'rgba(200,148,58,0.65)' }}>demo_seeded</strong> menu items appear.</li>
                  <li>If someone still cannot see a demo root, have them log out and back in (sync runs on login / session check).</li>
                </ul>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>AI Features</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)', lineHeight: '1.6', marginBottom: '16px' }}>
                <strong style={{ color: 'rgba(200,148,58,0.7)' }}>Session recaps</strong> use <strong>Anthropic</strong> (cloud, billed per token). The server sends session context to the API; the key stays on your server.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.6)', marginBottom: '3px' }}>AI FEATURES</div>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: aiEnabled ? 'rgba(200,148,58,0.8)' : 'rgba(226,213,187,0.3)' }}>
                    {aiEnabled ? 'Enabled — session recap generation' : 'Disabled — add Anthropic key below, then enable'}
                  </div>
                  {aiEnabled && (
                    <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '11px', color: recapGenerationReady ? 'rgba(80,200,120,0.45)' : 'rgba(220,140,100,0.5)', marginTop: '6px' }}>
                      Anthropic API key: {recapGenerationReady ? 'configured' : 'missing — save a key below'}
                    </div>
                  )}
                </div>
                <div style={S.toggle(aiEnabled)} onClick={async () => {
                  setAiWarning('');
                  setAiSaving(true);
                  try {
                    const res = await api.post('/admin/ai/settings', { ai_enabled: !aiEnabled });
                    applyAiSettingsResponse(res.data);
                    if (res.data.warning) setAiWarning(res.data.warning);
                  } finally { setAiSaving(false); }
                }}>
                  <div style={S.toggleDot(aiEnabled)} />
                </div>
              </div>

              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.4)', marginBottom: '8px' }}>
                ANTHROPIC API KEY
              </div>

              {aiKeySet && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px 12px', background: 'rgba(80,180,100,0.06)', border: '1px solid rgba(80,180,100,0.2)', borderRadius: '3px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgba(226,213,187,0.5)', flex: 1, letterSpacing: '0.05em' }}>{aiKeyMasked}</span>
                  <button onClick={async () => {
                    if (!window.confirm('Remove the saved API key? This will also disable AI features.')) return;
                    const res = await api.post('/admin/ai/clear-key');
                    applyAiSettingsResponse(res.data);
                    setAiTestResult(null);
                  }} style={{ background: 'none', border: '1px solid rgba(200,80,80,0.3)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,80,80,0.6)', padding: '3px 8px' }}>
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
                      applyAiSettingsResponse(res.data);
                      setAiKeyInput('');
                      if (res.data.warning) setAiWarning(res.data.warning);
                    } finally { setAiSaving(false); }
                  }}
                  style={{ padding: '8px 14px', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em', color: 'var(--ch-accent)', whiteSpace: 'nowrap' }}>
                  {aiSaving ? 'SAVING...' : 'SAVE KEY'}
                </button>
              </div>

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
                  style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.4)', marginBottom: '10px' }}>
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
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.25)', marginBottom: '6px' }}>SECURITY NOTICE</div>
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
                      <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.3)', marginBottom: '5px' }}>{item.label}</div>
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
                style={{ padding: '10px 22px', background: backupLoading ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, rgba(200,148,58,0.25), rgba(200,148,58,0.1))', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '3px', cursor: backupLoading ? 'not-allowed' : 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: backupLoading ? 'rgba(226,213,187,0.3)' : '#c8943a' }}>
                {backupLoading ? '⏳ PREPARING...' : '⬇ DOWNLOAD BACKUP'}
              </button>

              <div style={{ marginTop: '28px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={S.sectionTitle}>Chronicler JSON import</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.45)', lineHeight: '1.6', marginBottom: '14px' }}>
                  Restore a <strong style={{ color: 'var(--ch-text-primary-65)' }}>.json</strong> file exported by a DM from a world or campaign root. Usernames in the file must exist on this server (case-insensitive match). Uploaded note images are metadata only — copy image files from the old server’s data folder if you need binaries. Leave parent folder empty to create a new top-level root.
                </div>
                {jsonImportErr && (
                  <div style={{ padding: '8px 12px', borderRadius: '3px', marginBottom: '12px', background: 'rgba(200,80,80,0.08)', border: '1px solid rgba(200,80,80,0.25)', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(220,100,100,0.9)' }}>
                    {jsonImportErr}
                  </div>
                )}
                {jsonImportMsg && (
                  <div style={{ padding: '8px 12px', borderRadius: '3px', marginBottom: '12px', background: 'rgba(110,219,176,0.08)', border: '1px solid rgba(110,219,176,0.25)', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(110,219,176,0.95)' }}>
                    {jsonImportMsg}
                  </div>
                )}
                <label style={{ display: 'block', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.35)', marginBottom: '6px' }}>EXPORT FILE (.JSON)</label>
                <input
                  id="chronicler-json-import"
                  type="file"
                  accept=".json,application/json"
                  disabled={jsonImportBusy}
                  style={{ width: '100%', marginBottom: '12px', fontSize: '13px', color: 'rgba(226,213,187,0.6)' }}
                />
                <label style={{ display: 'block', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.35)', marginBottom: '6px' }}>PARENT FOLDER ID (OPTIONAL)</label>
                <input
                  style={{ ...S.input, marginBottom: '12px' }}
                  placeholder="Empty = new top-level tree"
                  value={jsonImportParentId}
                  onChange={(e) => setJsonImportParentId(e.target.value)}
                  disabled={jsonImportBusy}
                />
                <button
                  type="button"
                  disabled={jsonImportBusy}
                  onClick={async () => {
                    const el = document.getElementById('chronicler-json-import');
                    const file = el?.files?.[0];
                    if (!file) {
                      setJsonImportErr('Choose a JSON file first.');
                      setJsonImportMsg('');
                      return;
                    }
                    setJsonImportBusy(true);
                    setJsonImportErr('');
                    setJsonImportMsg('');
                    try {
                      const fd = new FormData();
                      fd.append('file', file);
                      const p = String(jsonImportParentId || '').trim();
                      if (p) fd.append('parent_id', p);
                      const res = await api.post('/admin/backup/import-json', fd);
                      const id = res.data?.new_root_id;
                      const c = res.data?.counts;
                      setJsonImportMsg(
                        `Imported. New root note id: ${id}. Notes: ${c?.notes ?? '—'}, sessions: ${c?.sessions ?? '—'}, connections: ${c?.connections ?? '—'}.`
                      );
                      if (typeof onChroniclerImportDone === 'function') onChroniclerImportDone();
                      try { el.value = ''; } catch { /* ignore */ }
                    } catch (e) {
                      const msg = e.response?.data?.error || e.message || 'Import failed';
                      setJsonImportErr(msg);
                    } finally {
                      setJsonImportBusy(false);
                    }
                  }}
                  style={{ padding: '10px 22px', background: jsonImportBusy ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, rgba(110,180,140,0.2), rgba(110,180,140,0.08))', border: '1px solid rgba(110,180,140,0.35)', borderRadius: '3px', cursor: jsonImportBusy ? 'not-allowed' : 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: jsonImportBusy ? 'rgba(226,213,187,0.3)' : 'rgba(110,219,176,0.9)' }}
                >
                  {jsonImportBusy ? '⏳ IMPORTING…' : '⬆ IMPORT JSON TREE'}
                </button>
              </div>

              <div style={{ marginTop: '20px', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(226,213,187,0.25)', marginBottom: '6px' }}>WHAT IS INCLUDED</div>
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
                style={{ padding: '9px 20px', background: 'linear-gradient(135deg, #c8943a, #a07030)', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: '#07080e' }}>
                CHANGE PASSWORD
              </button>
            </div>
          )}

          {tab === 'vault' && (
            <div ref={tutorialRefs?.vaultTree || null} style={S.section}>
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
                          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--ch-text-primary)', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {campaign.title}
                          </div>
                          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.3)' }}>
                            {campaign.owner} · {campaign.snapshots.length} snapshot{campaign.snapshots.length !== 1 ? 's' : ''}
                            {latest && <span style={{ marginLeft: '8px', color: 'rgba(200,148,58,0.4)' }}>Last: {new Date(latest.saved_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                          </div>
                        </div>
                        {campaign.snapshots.length === 0 && (
                          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', color: 'rgba(226,213,187,0.2)', letterSpacing: '0.1em' }}>NO SNAPSHOTS</span>
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
                                      <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(58,196,139,0.6)', background: 'rgba(58,196,139,0.08)', border: '1px solid rgba(58,196,139,0.15)', borderRadius: '10px', padding: '1px 6px' }}>LATEST</span>
                                    )}
                                  </div>
                                  {s.label && (
                                    <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'var(--ch-text-accent)', marginBottom: '6px', lineHeight: '1.35', wordBreak: 'break-word' }}>
                                      {s.label}
                                    </div>
                                  )}
                                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.25)', display: 'flex', gap: '12px' }}>
                                    <span>by {s.saved_by}</span>
                                    <span>{s.note_count} note{s.note_count !== 1 ? 's' : ''} captured</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleRestore(campaign.id, s.id, s.saved_at, campaign.title, s.label)}
                                  disabled={!!restoring}
                                  style={{ padding: '6px 14px', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: '3px', cursor: restoring ? 'default' : 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.1em', color: restoring === s.id ? 'rgba(200,148,58,0.3)' : 'rgba(200,148,58,0.7)', flexShrink: 0, opacity: restoring && restoring !== s.id ? 0.4 : 1 }}
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
});

export default AdminPanel;
