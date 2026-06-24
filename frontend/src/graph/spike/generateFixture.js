/**
 * Generates a synthetic campaign graph for sigma/WebGL benchmarks.
 * @param {number} nodeCount
 * @param {number} [avgDegree] - target average edges per node
 * @returns {{ notes: object[], connections: object[], positions: Record<string, { x: number, y: number }> }}
 */
export function generateBenchmarkGraph(nodeCount = 500, avgDegree = 2.4) {
  const categories = ['npc', 'location', 'faction', 'item', 'character'];
  const notes = [];
  const positions = {};
  const cols = Math.ceil(Math.sqrt(nodeCount));
  const spacing = 120;

  for (let i = 0; i < nodeCount; i++) {
    const id = i + 1;
    const row = Math.floor(i / cols);
    const col = i % cols;
    const jitter = (id % 7) * 4;
    notes.push({
      id,
      title: `Bench ${id}`,
      category: categories[i % categories.length],
    });
    positions[String(id)] = {
      x: col * spacing + jitter,
      y: row * spacing + jitter * 0.5,
    };
  }

  const connections = [];
  let connId = 1;
  for (let i = 0; i < nodeCount; i++) {
    const a = i + 1;
    const b = i + 2 <= nodeCount ? i + 2 : 1;
    connections.push({
      id: connId++,
      source_note_id: a,
      target_note_id: b,
      label: '',
      connection_kind: 'canon',
      direction: 'bidirectional',
    });
    if (i % 3 === 0 && i + cols + 1 <= nodeCount) {
      connections.push({
        id: connId++,
        source_note_id: a,
        target_note_id: i + cols + 1,
        label: '',
        connection_kind: 'canon',
        direction: 'bidirectional',
      });
    }
  }

  const targetEdges = Math.floor((nodeCount * avgDegree) / 2);
  while (connections.length < targetEdges) {
    const s = 1 + Math.floor(Math.random() * nodeCount);
    let t = 1 + Math.floor(Math.random() * nodeCount);
    if (t === s) continue;
    connections.push({
      id: connId++,
      source_note_id: s,
      target_note_id: t,
      label: '',
      connection_kind: Math.random() < 0.08 ? 'theory' : 'canon',
      direction: 'bidirectional',
      is_speculative: Math.random() < 0.08 ? 1 : 0,
    });
  }

  return { notes, connections, positions };
}
