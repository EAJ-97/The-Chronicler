/**
 * Simple 2D force-directed layout for graph organize preview (WebGL path).
 * @param {Array<{ id: string, x: number, y: number }>} nodes - nodes to move
 * @param {Array<{ source: string, target: string }>} edges
 * @param {{ iterations?: number, repulsion?: number, attraction?: number }} [opts]
 * @returns {Record<string, { x: number, y: number }>}
 */
export function runForceLayout2d(nodes, edges, opts = {}) {
  const iterations = opts.iterations ?? 120;
  const repulsion = opts.repulsion ?? 12000;
  const attraction = opts.attraction ?? 0.012;
  const positions = {};
  nodes.forEach((n) => {
    positions[n.id] = { x: n.x, y: n.y };
  });

  const nodeIds = nodes.map((n) => n.id);
  for (let iter = 0; iter < iterations; iter += 1) {
    const forces = {};
    nodeIds.forEach((id) => { forces[id] = { x: 0, y: 0 }; });

    for (let i = 0; i < nodeIds.length; i += 1) {
      for (let j = i + 1; j < nodeIds.length; j += 1) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const dx = positions[b].x - positions[a].x;
        const dy = positions[b].y - positions[a].y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[a].x -= fx;
        forces[a].y -= fy;
        forces[b].x += fx;
        forces[b].y += fy;
      }
    }

    edges.forEach((e) => {
      const a = e.source;
      const b = e.target;
      if (!positions[a] || !positions[b]) return;
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const force = dist * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces[a].x += fx;
      forces[a].y += fy;
      forces[b].x -= fx;
      forces[b].y -= fy;
    });

    const damp = 0.85 - (iter / iterations) * 0.35;
    nodeIds.forEach((id) => {
      positions[id].x += forces[id].x * damp;
      positions[id].y += forces[id].y * damp;
    });
  }

  return positions;
}
