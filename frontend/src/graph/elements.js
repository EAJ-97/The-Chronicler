import { getCategoryColor } from '../theme/categoryColors.js';
import { connectionKindClass, connectionDirectionClass } from './connections.js';

/**
 * Stable fingerprint of visible graph data — ignores parent re-render array identity.
 * @param {object[]} notes
 * @param {object[]} connections
 * @returns {string}
 */
export function buildGraphFingerprint(notes, connections) {
  return notes.map(n => `${n.id}:${n.title}:${n.category}`)
    .concat(connections.map(c => `${c.id}:${c.source_note_id}-${c.target_note_id}:${c.label || ''}:${c.connection_kind || ''}:${c.direction || 'bidirectional'}:${c.is_speculative ? 1 : 0}`))
    .join('|');
}

/**
 * Builds Cytoscape-style element objects from notes and connections.
 * @param {object[]} notes
 * @param {object[]} connections
 * @returns {object[]}
 */
export function buildElements(notes, connections) {
  const nodeIds = new Set(notes.map(n => String(n.id)));
  return [
    ...notes.map(note => ({
      data: {
        id: String(note.id),
        label: note.title,
        category: note.category,
        color: getCategoryColor(note.category),
      },
    })),
    ...connections
      .filter(conn => nodeIds.has(String(conn.source_note_id)) && nodeIds.has(String(conn.target_note_id)))
      .map(conn => ({
        data: {
          id: `e${conn.id}`,
          connId: conn.id,
          source: String(conn.source_note_id),
          target: String(conn.target_note_id),
          label: conn.label || '',
          direction: conn.direction || 'bidirectional',
        },
        classes: `${connectionKindClass(conn)} ${connectionDirectionClass(conn)}`,
      })),
  ];
}

/**
 * Builds graphology / sigma graph payloads from notes and connections.
 * @param {object[]} notes
 * @param {object[]} connections
 * @param {Record<string, { x: number, y: number }>} [positions]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildGraphModel(notes, connections, positions = {}) {
  const nodeIds = new Set(notes.map(n => String(n.id)));
  const nodes = notes.map(note => {
    const id = String(note.id);
    const pos = positions[id];
    return {
      id,
      label: note.title,
      category: note.category,
      color: getCategoryColor(note.category),
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
    };
  });
  const edges = connections
    .filter(conn => nodeIds.has(String(conn.source_note_id)) && nodeIds.has(String(conn.target_note_id)))
    .map(conn => ({
      id: `e${conn.id}`,
      connId: conn.id,
      source: String(conn.source_note_id),
      target: String(conn.target_note_id),
      label: conn.label || '',
      direction: conn.direction || 'bidirectional',
      kind: conn.connection_kind || (conn.is_speculative ? 'theory' : 'canon'),
    }));
  return { nodes, edges };
}
