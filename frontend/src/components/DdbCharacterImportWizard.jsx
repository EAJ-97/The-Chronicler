import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  setCobalt,
  setDdbUserId,
  clearCobalt,
  hasCobalt,
  ddbPost,
  parseCharacterIdFromInput,
} from '../utils/ddbCobalt.js';
import { notesByIdMap, isUnderCompletedArchive } from '../utils/campaignTree.js';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';

/**
 * Builds a folder-only tree for destination picking.
 * @param {Array<object>} notes
 * @returns {Array<object>}
 */
function buildFolderTree(notes) {
  const folders = (notes || []).filter((n) => n.is_folder);
  const map = {};
  const roots = [];
  folders.forEach((n) => { map[n.id] = { ...n, children: [] }; });
  folders.forEach((n) => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });
  return roots;
}

/**
 * True when the note lives under a demo root campaign (non-admins cannot import there).
 * @param {Array<object>} notes
 * @param {number} noteId
 * @returns {boolean}
 */
function isUnderDemoRoot(notes, noteId) {
  const map = notesByIdMap(notes);
  let cur = map.get(noteId);
  while (cur) {
    if (cur.parent_id == null && cur.is_folder && Number(cur.is_demo) === 1) return true;
    cur = cur.parent_id != null ? map.get(cur.parent_id) : null;
  }
  return false;
}

/**
 * Renders one selectable folder row in the import destination tree.
 * @param {{ node: object, depth: number, selectedId: number|null, onSelect: (id: number) => void }} props
 */
function FolderOption({ node, depth, selectedId, onSelect }) {
  const selected = selectedId === node.id;
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        style={{
          padding: `8px 12px 8px ${14 + depth * 16}px`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'Cinzel',
          fontSize: '11px',
          color: selected ? '#c8943a' : 'rgba(226,213,187,0.7)',
          letterSpacing: '0.05em',
          background: selected ? 'rgba(200,148,58,0.12)' : 'transparent',
        }}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(node.id)}
      >
        <span>📁</span>
        {node.title}
      </div>
      {node.children.map((c) => (
        <FolderOption key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 650,
  background: 'rgba(0,0,0,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

const panel = {
  background: '#0a0c14',
  border: '1px solid rgba(200,148,58,0.25)',
  borderRadius: '8px',
  maxWidth: '640px',
  width: '100%',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(200,148,58,0.2)',
  borderRadius: '4px',
  color: 'rgba(226,213,187,0.9)',
  fontFamily: 'Crimson Pro, serif',
  fontSize: '15px',
  padding: '10px 12px',
};

/**
 * Three-step wizard: pick D&D Beyond character → pick folder → preview & import.
 * CobaltSession stays in localStorage only (Foundry-style); sent per request, never stored on server.
 * @param {{ onClose: () => void, notes: Array<object>, currentUser: object, onImported: (noteId: number) => void }} props
 */
export default function DdbCharacterImportWizard({ onClose, notes, currentUser, onImported }) {
  const [step, setStep] = useState(1);
  const [characterInput, setCharacterInput] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [characterList, setCharacterList] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listWarning, setListWarning] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  const [cobaltDraft, setCobaltDraft] = useState('');
  const [connected, setConnected] = useState(hasCobalt());
  const [parentId, setParentId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isAdmin = !!currentUser?.is_admin;

  const folderTree = useMemo(() => {
    const tree = buildFolderTree(notes);
    const filterNode = (node) => {
      if (!isAdmin && isUnderDemoRoot(notes, node.id)) return null;
      if (isUnderCompletedArchive(notes, node.id)) return null;
      const children = node.children.map(filterNode).filter(Boolean);
      return { ...node, children };
    };
    return tree.map(filterNode).filter(Boolean);
  }, [notes, isAdmin]);

  const resolvedCharacterId = selectedCharacterId || parseCharacterIdFromInput(characterInput);

  /**
   * Loads the user's D&D Beyond character list when cobalt is saved locally.
   */
  const loadCharacterList = useCallback(async () => {
    if (!hasCobalt()) return;
    setListLoading(true);
    setListWarning('');
    try {
      const res = await ddbPost('/characters/list', {});
      setCharacterList(res.data.characters || []);
    } catch (e) {
      setCharacterList([]);
      const msg = e.response?.data?.error || e.message || 'Could not load character list';
      const invalidCobalt =
        e.response?.status === 422
        && e.response?.data?.ddb
        && /invalid|expired|forbidden|authenticate/i.test(msg)
        && !/list characters|paste your character|Cobalt\.User/i.test(msg);
      if (invalidCobalt) {
        clearCobalt();
        setConnected(false);
        setErr(msg);
      } else {
        setListWarning(`${msg} Paste a character URL above instead.`);
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) loadCharacterList();
  }, [connected, loadCharacterList]);

  /** Sync connected badge when wizard opens (cobalt may exist from a prior session). */
  useEffect(() => {
    setConnected(hasCobalt());
  }, []);

  /**
   * Saves cobalt to localStorage after a successful auth test.
   */
  const saveCobalt = async () => {
    const val = cobaltDraft.trim();
    if (!val) {
      setErr('Paste your CobaltSession cookie first');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await ddbPost('/auth/test', { cobalt: val });
      setCobalt(val);
      const resolvedId = res.data?.user_id;
      if (resolvedId) setDdbUserId(String(resolvedId));
      setConnected(true);
      setCobaltDraft('');
      await loadCharacterList();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clears local cobalt and character list state.
   */
  const disconnectCobalt = () => {
    clearCobalt();
    setConnected(false);
    setCharacterList([]);
    setCobaltDraft('');
  };

  /**
   * Fetches markdown preview for the selected character.
   */
  const fetchPreview = async () => {
    if (!resolvedCharacterId) {
      setErr('Paste a D&D Beyond character URL or pick from your list');
      return false;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await ddbPost('/character/fetch', { character_id: resolvedCharacterId });
      setPreview({ title: res.data.title, content: res.data.content, tags: res.data.tags });
      return true;
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Could not load character');
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Advances from step 1 after validating character and loading preview.
   */
  const onStep1Next = async () => {
    const ok = await fetchPreview();
    if (ok) setStep(2);
  };

  /**
   * Creates the note under the chosen folder.
   */
  const runImport = async () => {
    if (!resolvedCharacterId || !parentId) return;
    setBusy(true);
    setErr('');
    try {
      const res = await ddbPost('/import', {
        character_id: resolvedCharacterId,
        parent_id: parentId,
      });
      if (typeof onImported === 'function') onImported(res.data.id);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const stepLabels = ['Character', 'Folder', 'Import'];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '13px', letterSpacing: '0.18em', color: '#c8943a' }}>IMPORT D&amp;D BEYOND</div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.35)', marginTop: '4px' }}>
              Step {step} of 3 — {stepLabels[step - 1]}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.35)', fontSize: '22px', cursor: 'pointer' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {err && (
            <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'rgba(180,60,60,0.15)', border: '1px solid rgba(180,60,60,0.35)', borderRadius: '4px', color: 'rgba(255,180,180,0.95)', fontFamily: 'Crimson Pro, serif', fontSize: '14px' }}>
              {err}
            </div>
          )}

          {step === 1 && (
            <>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.55)', margin: '0 0 12px', lineHeight: 1.5 }}>
                Paste a character URL from dndbeyond.com. Public characters work without any setup.
              </p>
              <label style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>CHARACTER URL</label>
              <input
                style={inputStyle}
                placeholder="https://www.dndbeyond.com/characters/123456789"
                value={characterInput}
                onChange={(e) => {
                  setCharacterInput(e.target.value);
                  setSelectedCharacterId(null);
                }}
              />

              {connected && (listLoading || characterList.length > 0) && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(110,219,176,0.7)', marginBottom: '8px' }}>
                    ✓ D&amp;D Beyond connected on this device
                  </div>
                  <label style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>MY CHARACTERS (OPTIONAL)</label>
                  <select
                    style={{ ...inputStyle, fontSize: '14px', colorScheme: 'dark' }}
                    value={selectedCharacterId ?? ''}
                    disabled={listLoading}
                    onChange={(e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      setSelectedCharacterId(id);
                      if (id) setCharacterInput(`https://www.dndbeyond.com/characters/${id}`);
                    }}
                  >
                    <option value="" style={{ background: '#1c1814', color: '#e2d5bb' }}>
                      {listLoading ? 'Loading…' : 'Choose a character…'}
                    </option>
                    {characterList.map((c) => (
                      <option key={c.id} value={c.id} style={{ background: '#1c1814', color: '#e2d5bb' }}>
                        {c.name}{c.level != null ? ` — Level ${c.level}` : ''}{c.classSummary ? ` (${c.classSummary})` : ''}
                      </option>
                    ))}
                  </select>
                  {listWarning && (
                    <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(200,148,58,0.65)', margin: '8px 0 0', lineHeight: 1.45 }}>
                      {listWarning}
                    </p>
                  )}
                </div>
              )}

              {connected && !listLoading && characterList.length === 0 && !listWarning && (
                <div style={{ marginTop: '14px', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(110,219,176,0.7)' }}>
                  ✓ D&amp;D Beyond connected — paste a character URL above
                </div>
              )}

              <button
                type="button"
                style={{ marginTop: '14px', background: 'none', border: 'none', color: 'rgba(200,148,58,0.65)', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', cursor: 'pointer', padding: 0 }}
                onClick={() => setShowPrivate((v) => !v)}
              >
                {showPrivate ? '▾' : '▸'} Private character or browse my list
              </button>

              {showPrivate && (
                <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px' }}>
                  <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.45)', margin: '0 0 10px', lineHeight: 1.45 }}>
                    Copy <strong style={{ color: 'rgba(226,213,187,0.65)' }}>CobaltSession</strong> from Firefox Storage → Cookies → dndbeyond.com (filter &quot;cobalt&quot;).
                    Do not use <em>cobalt-token</em>.
                    Then paste your private character URL above — you do not need an account ID.
                  </p>
                  {connected ? (
                    <button type="button" onClick={disconnectCobalt} style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(255,160,160,0.8)', background: 'transparent', border: '1px solid rgba(255,160,160,0.3)', borderRadius: '3px', padding: '6px 12px', cursor: 'pointer' }}>
                      Disconnect this device
                    </button>
                  ) : (
                    <>
                      <input
                        type="password"
                        style={inputStyle}
                        placeholder="CobaltSession value"
                        value={cobaltDraft}
                        onChange={(e) => setCobaltDraft(e.target.value)}
                      />
                      <button type="button" disabled={busy} onClick={saveCobalt} style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: '#c8943a', background: 'rgba(200,148,58,0.1)', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '3px', padding: '8px 14px', cursor: busy ? 'wait' : 'pointer' }}>
                        {busy ? 'Testing…' : 'Save & connect'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.55)', margin: '0 0 12px' }}>
                Choose the folder where the new character note will be created.
              </p>
              <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', maxHeight: '280px', overflowY: 'auto' }}>
                {folderTree.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(226,213,187,0.25)', fontFamily: 'Crimson Pro, serif' }}>No folders available</div>
                ) : (
                  folderTree.map((node) => (
                    <FolderOption key={node.id} node={node} depth={0} selectedId={parentId} onSelect={setParentId} />
                  ))
                )}
              </div>
            </>
          )}

          {step === 3 && preview && (
            <>
              <div style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.1em', color: '#c8943a', marginBottom: '8px' }}>{preview.title}</div>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.45)', margin: '0 0 10px' }}>
                The portrait appears in the note under the name and as the sidebar icon (scaled to fit). Opening the note later can check D&amp;D Beyond for flavor updates.
              </p>
              <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.75)' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={chroniclerUrlTransform}>{preview.content}</ReactMarkdown>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <button
            type="button"
            disabled={step === 1 || busy}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.45)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', padding: '8px 16px', cursor: step === 1 ? 'default' : 'pointer', opacity: step === 1 ? 0.4 : 1 }}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={busy || (step === 2 && !parentId)}
              onClick={() => {
                if (step === 1) onStep1Next();
                else if (step === 2) setStep(3);
              }}
              style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: '#c8943a', background: 'rgba(200,148,58,0.12)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '3px', padding: '8px 20px', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Loading…' : 'Next'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !parentId}
              onClick={runImport}
              style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(110,219,176,0.95)', background: 'rgba(110,180,140,0.15)', border: '1px solid rgba(110,180,140,0.4)', borderRadius: '3px', padding: '8px 20px', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Importing…' : 'Import as new note'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
