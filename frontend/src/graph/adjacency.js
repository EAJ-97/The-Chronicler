import { MAX_HOPS } from './constants.js';

/**
 * True when a connection counts as canonical for tier/path BFS (not theory/ship).
 * @param {{ connection_kind?: string, is_speculative?: boolean|number }} conn
 * @returns {boolean}
 */
export function isCanonConnection(conn) {
  const k = conn.connection_kind;
  if (k === 'theory' || k === 'ship') return false;
  if (k === 'canon') return true;
  return !conn.is_speculative;
}

/**
 * Precomputes directed canon adjacency for O(1) neighbour lookup during BFS.
 * @param {object[]} connections
 * @returns {Map<string, string[]>}
 */
export function buildCanonAdjacency(connections) {
  const adj = new Map();
  const add = (from, to) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  };
  for (const c of connections) {
    if (!isCanonConnection(c)) continue;
    const s = String(c.source_note_id);
    const t = String(c.target_note_id);
    const dir = c.direction || 'bidirectional';
    if (dir === 'bidirectional') { add(s, t); add(t, s); }
    else if (dir === 'forward') add(s, t);
    else if (dir === 'reverse') add(t, s);
  }
  return adj;
}

/**
 * BFS hop depths from startId using precomputed canon adjacency.
 * @param {Map<string, string[]>} adj
 * @param {string|number} startId
 * @param {number} [maxDepth]
 * @returns {Map<string, number>}
 */
export function getTiersFromAdj(adj, startId, maxDepth = MAX_HOPS) {
  const tiers = new Map();
  const start = String(startId);
  const queue = [[start, 0]];
  tiers.set(start, 0);
  while (queue.length > 0) {
    const [id, depth] = queue.shift();
    if (depth >= maxDepth) continue;
    for (const nid of (adj.get(id) || [])) {
      if (!tiers.has(nid)) {
        tiers.set(nid, depth + 1);
        queue.push([nid, depth + 1]);
      }
    }
  }
  return tiers;
}

/**
 * Returns all shortest paths between src and tgt, capped at maxPaths (canonical edges only).
 * @param {Map<string, string[]>} adj
 * @param {string|number} srcId
 * @param {string|number} tgtId
 * @param {number} [maxPaths]
 * @returns {string[][]}
 */
export function getAllShortestPaths(adj, srcId, tgtId, maxPaths = 3) {
  const src = String(srcId);
  const tgt = String(tgtId);
  if (src === tgt) return [];

  const dist = new Map([[src, 0]]);
  const parents = new Map([[src, []]]);
  const queue = [src];
  let found = false;

  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    if (cur === tgt) { found = true; break; }
    for (const nid of (adj.get(cur) || [])) {
      if (!dist.has(nid)) {
        dist.set(nid, d + 1);
        parents.set(nid, [cur]);
        queue.push(nid);
      } else if (dist.get(nid) === d + 1) {
        parents.get(nid).push(cur);
      }
    }
  }

  if (!found) return [];

  const paths = [];
  const stack = [[tgt, [tgt]]];
  while (stack.length && paths.length < maxPaths) {
    const [node, path] = stack.pop();
    if (node === src) { paths.push([...path].reverse()); continue; }
    for (const p of (parents.get(node) || [])) stack.push([p, [...path, p]]);
  }
  return paths;
}
