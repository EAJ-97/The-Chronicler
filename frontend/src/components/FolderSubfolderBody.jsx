import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';
import { buildMarkdownCss } from '../theme/markdownCss.js';
import FolderDmTabsPane from './FolderDmTabsPane.jsx';
import FolderNoteCards from './FolderNoteCards.jsx';
import { PEEK_SPLIT_TRANSITION } from '../utils/panelAnimation.js';

/** Even 50/50 column in a horizontal split (overview | right pane). */
const splitColumn = {
  flex: '1 1 50%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  transition: PEEK_SPLIT_TRANSITION,
};

/**
 * Organizer subfolder body: party overview (edit/view) + optional DM split or note cards (50/50).
 * Cards use a fixed layout; overview and DM panes follow the global view/edit toggle.
 *
 * @param {object} props
 */
export default function FolderSubfolderBody({
  viewMode,
  isMobile,
  showFolderDmSplit,
  showFolderNoteCards,
  folderPreviewNotes,
  folderId,
  allNotes,
  content,
  canEdit,
  onContentChange,
  onEditorKeyDown,
  contentTextareaRef,
  onOpenNote,
  markdownComponents,
  theme,
  editorStyle,
  previewStyle,
  folderDmTabs,
  activeDmTabId,
  onFolderDmTabsChange,
  onActiveDmTabChange,
  onDmDirty,
  dmNoteId,
  campaignSplitRef,
  partyPaneRef,
  mentionPopup,
}) {
  const useSideBySide = showFolderDmSplit || showFolderNoteCards;
  const col = isMobile
    ? { ...splitColumn, flex: '1 1 auto', minHeight: '200px' }
    : splitColumn;

  const overviewHeader = (
    <div
      ref={partyPaneRef}
      style={{
        fontFamily: 'var(--ch-font-display)',
        fontSize: '8px',
        letterSpacing: '0.14em',
        color: 'rgba(139,196,226,0.55)',
        padding: '10px 24px 6px',
        flexShrink: 0,
      }}
    >
      {showFolderDmSplit ? 'Party-visible overview' : 'Folder overview'}
    </div>
  );

  const overviewContent = viewMode === 'edit' ? (
    <textarea
      ref={contentTextareaRef}
      style={{
        ...editorStyle,
        flex: 1,
        minHeight: '120px',
        paddingTop: '8px',
      }}
      value={content}
      onChange={onContentChange}
      onKeyDown={onEditorKeyDown}
      placeholder={
        canEdit
          ? 'Introduction and lore players can read… Markdown supported. Type @ to link notes.'
          : 'Read-only.'
      }
      readOnly={!canEdit}
      spellCheck={false}
    />
  ) : (
    <div style={{ ...previewStyle, flex: 1, overflow: 'auto', minHeight: 0 }} className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={chroniclerUrlTransform}
        components={markdownComponents}
      >
        {content?.trim() ? content : '*No overview written yet.*'}
      </ReactMarkdown>
      <style>{buildMarkdownCss(theme)}</style>
    </div>
  );

  const overviewPane = (
    <div
      style={{
        ...(useSideBySide ? col : { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }),
        borderRight: useSideBySide && !isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
        borderBottom: useSideBySide && isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}
    >
      {overviewHeader}
      {overviewContent}
    </div>
  );

  const rightPane = showFolderDmSplit ? (
    <div
      style={{
        ...col,
        background: 'rgba(200,148,58,0.03)',
      }}
    >
      <FolderDmTabsPane
        tabs={folderDmTabs}
        activeTabId={activeDmTabId}
        onTabsChange={onFolderDmTabsChange}
        onActiveTabChange={onActiveDmTabChange}
        onDirty={onDmDirty}
        canEdit={canEdit}
        viewMode={viewMode}
        editorStyle={editorStyle}
        previewStyle={previewStyle}
        markdownComponents={markdownComponents}
        markdownCss={<style>{buildMarkdownCss(theme)}</style>}
        noteId={dmNoteId}
      />
    </div>
  ) : showFolderNoteCards ? (
    <div style={{ ...col, background: 'rgba(139,196,226,0.02)' }}>
      <FolderNoteCards
        childNotes={folderPreviewNotes}
        allNotes={allNotes}
        folderId={folderId}
        onOpenNote={onOpenNote}
        containerStyle={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
    </div>
  ) : null;

  if (useSideBySide) {
    return (
      <div
        ref={campaignSplitRef}
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          minHeight: 0,
          height: '100%',
        }}
      >
        {overviewPane}
        {rightPane}
        {mentionPopup}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', height: '100%' }}>
      {overviewPane}
      {mentionPopup}
    </div>
  );
}
