import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';
import { createDmTab } from '../utils/folderDmTabs.js';

/** Shared tab bar button styles (matches NoteEditor viewBtn). */
const tabBtn = (active) => ({
  padding: '4px 10px',
  borderRadius: '3px',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--ch-font-display)',
  fontSize: '9px',
  letterSpacing: '0.1em',
  background: active ? 'rgba(200,148,58,0.2)' : 'transparent',
  color: active ? '#c8943a' : 'rgba(226,213,187,0.35)',
  transition: 'all 0.2s',
  maxWidth: '140px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

/**
 * DM-only tabbed notes pane for world/campaign root folders.
 * Supports renameable tabs with markdown edit/preview per tab.
 *
 * @param {{ id: string, title: string, content: string }[]} tabs
 * @param {string} activeTabId
 * @param {(tabs: { id: string, title: string, content: string }[]) => void} onTabsChange
 * @param {(tabId: string) => void} onActiveTabChange
 * @param {() => void} onDirty
 * @param {boolean} canEdit
 * @param {'edit'|'view'} viewMode
 * @param {object} editorStyle - textarea style from parent (S.editor)
 * @param {object} previewStyle - preview container style from parent
 * @param {object} markdownComponents - ReactMarkdown components
 * @param {string} markdownCss - injected style block from buildMarkdownCss
 * @param {number} noteId - used for localStorage key for last active tab
 */
export default function FolderDmTabsPane({
  tabs,
  activeTabId,
  onTabsChange,
  onActiveTabChange,
  onDirty,
  canEdit,
  viewMode,
  editorStyle,
  previewStyle,
  markdownComponents,
  markdownCss,
  noteId,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  const tabsScrollRef = useRef(null);
  const tabChipRefs = useRef({});

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  /** Focus rename input when a tab enters rename mode. */
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  /** Keeps the active tab chip visible when the tab bar overflows horizontally. */
  useEffect(() => {
    const el = tabChipRefs.current[activeTab?.id];
    if (el?.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [activeTab?.id]);

  /**
   * Updates one tab field and notifies parent.
   * @param {string} tabId
   * @param {Partial<{ title: string, content: string }>} patch
   */
  const patchTab = (tabId, patch) => {
    onTabsChange(tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
    onDirty();
  };

  /**
   * Adds a new empty tab and selects it.
   */
  const handleAddTab = () => {
    const next = createDmTab('New tab');
    onTabsChange([...tabs, next]);
    onActiveTabChange(next.id);
    if (noteId) {
      try {
        localStorage.setItem(`chronicler_dmTab_${noteId}`, next.id);
      } catch {
        /* ignore */
      }
    }
    onDirty();
  };

  /**
   * Removes a tab after user confirmation; selects an adjacent tab when the active tab is deleted.
   * @param {string} tabId
   */
  const handleRemoveTab = (tabId) => {
    if (tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    const label = tab?.title?.trim() || 'Untitled';
    const hasContent = !!String(tab?.content || '').trim();
    const msg = hasContent
      ? `Delete tab "${label}"? All markdown in this tab will be removed.`
      : `Delete tab "${label}"?`;
    if (!window.confirm(msg)) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    onTabsChange(nextTabs);
    if (activeTabId === tabId) {
      const newActive = nextTabs[Math.min(idx, nextTabs.length - 1)];
      onActiveTabChange(newActive.id);
    }
    onDirty();
  };

  /**
   * Commits inline tab title rename.
   * @param {string} tabId
   */
  const commitRename = (tabId) => {
    const title = renameDraft.trim() || 'Untitled';
    patchTab(tabId, { title });
    setRenamingId(null);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontFamily: 'var(--ch-font-display)',
          fontSize: '8px',
          letterSpacing: '0.14em',
          color: 'rgba(200,148,58,0.65)',
          padding: '10px 24px 4px',
          flexShrink: 0,
        }}
      >
        DM notes (hidden from players)
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0 16px 8px',
          flexShrink: 0,
          minWidth: 0,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          ref={tabsScrollRef}
          className="dm-tabs-scroll"
          style={{
            display: 'flex',
            gap: '4px',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            overflowY: 'hidden',
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            paddingBottom: '6px',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(200,148,58,0.35) transparent',
          }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            if (renamingId === tab.id && canEdit) {
              return (
                <input
                  key={tab.id}
                  ref={renameInputRef}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(tab.id);
                    }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  style={{
                    width: '100px',
                    flexShrink: 0,
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--ch-font-display)',
                    letterSpacing: '0.06em',
                    background: 'rgba(200,148,58,0.12)',
                    border: '1px solid rgba(200,148,58,0.35)',
                    borderRadius: '3px',
                    color: 'var(--ch-text-primary)',
                    outline: 'none',
                  }}
                />
              );
            }
            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) tabChipRefs.current[tab.id] = el;
                  else delete tabChipRefs.current[tab.id];
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 0, flexShrink: 0 }}
              >
                <button
                  type="button"
                  title={canEdit ? 'Double-click to rename' : tab.title}
                  onClick={() => onActiveTabChange(tab.id)}
                  onDoubleClick={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setRenamingId(tab.id);
                    setRenameDraft(tab.title);
                  }}
                  style={tabBtn(active)}
                >
                  {tab.title}
                </button>
                {canEdit && tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove tab ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTab(tab.id);
                    }}
                    style={{
                      marginLeft: '-2px',
                      padding: '2px 5px',
                      border: 'none',
                      background: 'transparent',
                      color: 'rgba(226,213,187,0.25)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={handleAddTab}
            title="Add DM tab"
            style={{
              ...tabBtn(false),
              color: 'rgba(200,148,58,0.55)',
              padding: '4px 12px',
              flexShrink: 0,
            }}
          >
            +
          </button>
        )}
      </div>
      {viewMode === 'edit' ? (
        <textarea
          key={activeTab?.id}
          style={{
            ...editorStyle,
            flex: 1,
            minHeight: '180px',
            paddingTop: '8px',
            background: 'transparent',
          }}
          value={activeTab?.content ?? ''}
          onChange={(e) => patchTab(activeTab.id, { content: e.target.value })}
          placeholder={canEdit ? 'Plans, secrets, reminders for DMs only… Markdown supported.' : ''}
          readOnly={!canEdit}
          spellCheck={false}
        />
      ) : (
        <div
          style={previewStyle}
          className="md-content md-dm"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={chroniclerUrlTransform}
            components={markdownComponents}
          >
            {activeTab?.content?.trim() ? activeTab.content : '*No content in this tab yet.*'}
          </ReactMarkdown>
          {markdownCss}
        </div>
      )}
    </div>
  );
}
