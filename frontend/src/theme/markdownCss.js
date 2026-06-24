/**
 * Builds markdown typography CSS from theme tokens (injected via style tag).
 * @param {import('./schema.js').ChroniclerTheme} theme
 * @returns {string}
 */
export function buildMarkdownCss(theme) {
  const { colors, fonts } = theme;
  const display = `'${fonts.display}', serif`;
  const body = `'${fonts.body}', Georgia, serif`;
  const accent = colors.accent;
  const text = colors.textPrimary;

  return `
  .md-content h1, .md-content h2, .md-content h3,
  .md-preview h1, .md-preview h2, .md-preview h3,
  .md-ref-peek h1, .md-ref-peek h2, .md-ref-peek h3 {
    font-family: ${display};
    color: ${accent};
    margin: 16px 0 6px;
    letter-spacing: 0.04em;
  }
  .md-preview h1, .md-ref-peek h1 { font-size: 16px; }
  .md-preview h2, .md-ref-peek h2 { font-size: 14px; }
  .md-preview h3, .md-ref-peek h3 { font-size: 13px; }
  .md-content p, .md-preview p, .md-ref-peek p { margin: 0 0 10px; }
  .md-content, .md-preview, .md-ref-peek {
    font-family: ${body};
    color: ${text};
    line-height: 1.65;
    font-size: 15px;
  }
  .md-content strong, .md-preview strong, .md-ref-peek strong { color: ${text}; font-weight: 600; }
  .md-content em, .md-preview em, .md-ref-peek em { font-style: italic; }
  .md-content a, .md-preview a, .md-ref-peek a { color: ${accent}; }
  .md-content code, .md-preview code, .md-ref-peek code {
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .md-content pre, .md-preview pre, .md-ref-peek pre {
    background: rgba(255,255,255,0.04);
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .md-content blockquote, .md-preview blockquote, .md-ref-peek blockquote {
    border-left: 3px solid ${accent};
    margin: 8px 0;
    padding-left: 12px;
    opacity: 0.85;
  }
  .md-content ul, .md-preview ul, .md-ref-peek ul,
  .md-content ol, .md-preview ol, .md-ref-peek ol {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  .md-content li, .md-preview li, .md-ref-peek li { margin-bottom: 4px; }
  .md-content hr, .md-preview hr, .md-ref-peek hr {
    border: none;
    border-top: 1px solid ${colors.border};
    margin: 14px 0;
  }
  .md-content table, .md-preview table, .md-ref-peek table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 13px;
  }
  .md-content th, .md-preview th, .md-ref-peek th,
  .md-content td, .md-preview td, .md-ref-peek td {
    border: 1px solid ${colors.borderStrong};
    padding: 6px 10px;
    text-align: left;
  }
  .md-content th, .md-preview th, .md-ref-peek th {
    font-family: ${display};
    color: ${accent};
    font-size: 11px;
    letter-spacing: 0.06em;
  }
`;
}
