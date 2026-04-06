import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../api.js';
import { getGraphCampaignRoots } from '../utils/campaignTree.js';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';

/**
 * Parses SQLite datetime strings into a JavaScript Date (UTC-safe for "Z" suffix).
 * @param {string|null|undefined} dateStr
 * @returns {Date}
 */
function parseSQLiteDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  return new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
}

/**
 * @param {string|null|undefined} dateStr
 * @param {string|null|undefined} serverNow
 * @returns {string}
 */
function formatDay(dateStr, serverNow) {
  const d = parseSQLiteDate(dateStr);
  const ref = serverNow ? new Date(serverNow) : new Date();
  const today = new Date(ref); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  if (dDay.getTime() === today.getTime()) return 'Today';
  if (dDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Groups journal entries under sessions for a vertical timeline (read-only).
 * @param {Array<object>} sessions
 * @param {Array<object>} entries
 * @param {string|null|undefined} serverNow
 * @returns {Array<{ session: object, sessionNum: number, parts: Array<{ date: string, entries: object[] }> }>}
 */
function groupSessions(sessions, entries, serverNow) {
  return sessions.map((session, idx) => {
    const sessionEntries = entries.filter((e) => e.session_id === session.id);
    const parts = [];
    let currentDate = null;
    let currentEntries = [];
    sessionEntries.forEach((entry) => {
      const day = formatDay(entry.created_at, serverNow);
      if (day !== currentDate) {
        if (currentEntries.length) parts.push({ date: currentDate, entries: currentEntries });
        currentDate = day;
        currentEntries = [entry];
      } else {
        currentEntries.push(entry);
      }
    });
    if (currentEntries.length) parts.push({ date: currentDate, entries: currentEntries });
    return { session, sessionNum: idx + 1, parts };
  });
}

/**
 * Read-only chronological view of journal sessions and entries for a playable campaign.
 * Uses GET /journal?folder_id= (same payload as Journal).
 * @param {{ notes: Array<object>, currentUser?: { id?: number } }} props
 */
export default function TimelineView({ notes, currentUser }) {
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serverNow, setServerNow] = useState(null);

  const campaignRoots = useMemo(() => getGraphCampaignRoots(notes), [notes]);

  const folderKey = `chronicler_timeline_folder_${currentUser?.id || 'anon'}`;
  const [activeFolderId, setActiveFolderIdRaw] = useState(() => {
    try {
      const s = localStorage.getItem(folderKey);
      return s ? parseInt(s, 10) : null;
    } catch {
      return null;
    }
  });
  /**
   * Persists selected campaign folder for the timeline tab.
   * @param {number|null} id
   */
  const setActiveFolderId = (id) => {
    setActiveFolderIdRaw(id);
    try {
      if (id) localStorage.setItem(folderKey, String(id));
      else localStorage.removeItem(folderKey);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    api.get('/server-time').then((r) => setServerNow(r.data.now)).catch(() => {});
  }, []);

  useEffect(() => {
    if (campaignRoots.length === 0) return;
    const ids = new Set(campaignRoots.map((f) => f.id));
    if (activeFolderId == null || !ids.has(activeFolderId)) {
      setActiveFolderId(campaignRoots[0].id);
    }
  }, [campaignRoots, activeFolderId]);

  const loadJournal = useCallback(async () => {
    if (!activeFolderId) return;
    setLoading(true);
    try {
      const res = await api.get('/journal', { params: { folder_id: activeFolderId } });
      setSessions(res.data.sessions || []);
      setEntries(res.data.entries || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeFolderId]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  useEffect(() => {
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data || e.detail);
        if (msg.type === 'journal_changed') loadJournal();
      } catch { /* ignore */ }
    };
    window.addEventListener('ws_journal', handler);
    return () => window.removeEventListener('ws_journal', handler);
  }, [loadJournal]);

  const grouped = useMemo(
    () => groupSessions(sessions, entries, serverNow),
    [sessions, entries, serverNow]
  );

  if (campaignRoots.length === 0) {
    return (
      <div style={{ padding: '24px', fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.45)' }}>
        No playable campaigns yet. Create a campaign folder to see a timeline of journal sessions.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07080e', overflow: 'hidden' }}>
      <div
        style={{
          flexShrink: 0,
          padding: '12px 20px',
          borderBottom: '1px solid rgba(200,148,58,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(200,148,58,0.55)' }}>
          CAMPAIGN
        </span>
        <select
          value={activeFolderId ?? ''}
          onChange={(e) => setActiveFolderId(e.target.value ? parseInt(e.target.value, 10) : null)}
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(200,148,58,0.25)',
            borderRadius: '4px',
            color: '#e2d5bb',
            fontFamily: 'Cinzel',
            fontSize: '11px',
            padding: '8px 12px',
            minWidth: '200px',
            cursor: 'pointer',
          }}
        >
          {campaignRoots.map((f) => (
            <option key={f.id} value={f.id}>{f.title || 'Untitled'}</option>
          ))}
        </select>
        <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.35)' }}>
          Read-only — newest sessions at the bottom
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px 32px' }}>
        {loading ? (
          <div style={{ fontFamily: 'Cinzel', fontSize: '10px', color: 'rgba(200,148,58,0.45)', letterSpacing: '0.12em' }}>
            Loading…
          </div>
        ) : grouped.length === 0 ? (
          <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.4)' }}>
            No sessions yet. Add sessions from the Journal tab.
          </div>
        ) : (
          grouped.map(({ session, sessionNum, parts }) => (
            <div key={session.id} style={{ marginBottom: '28px' }}>
              <div
                style={{
                  fontFamily: 'Cinzel',
                  fontSize: '10px',
                  letterSpacing: '0.14em',
                  color: '#c8943a',
                  marginBottom: '10px',
                  paddingBottom: '6px',
                  borderBottom: '1px solid rgba(200,148,58,0.15)',
                }}
              >
                SESSION {sessionNum}
                {session.title ? ` — ${session.title}` : ''}
              </div>
              {parts.map((part) => (
                <div key={`${session.id}-${part.date}`} style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      fontFamily: 'Cinzel',
                      fontSize: '8px',
                      letterSpacing: '0.12em',
                      color: 'rgba(200,148,58,0.4)',
                      marginBottom: '8px',
                    }}
                  >
                    {part.date}
                  </div>
                  {part.entries.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        marginLeft: `${(entry.indent_level || 0) * 20}px`,
                        marginBottom: '10px',
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: '4px',
                        borderLeft: '2px solid rgba(200,148,58,0.25)',
                      }}
                    >
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', lineHeight: 1.75, color: '#e2d5bb' }} className="md-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={chroniclerUrlTransform}>
                          {entry.content || ''}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
