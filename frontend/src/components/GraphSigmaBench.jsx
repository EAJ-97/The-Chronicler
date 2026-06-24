import { useEffect, useRef, useState } from 'react';
import { mountSigmaBench } from '../graph/spike/mountSigmaBench.js';
import { graphSizeScore, selectGraphRenderer } from '../graph/selectRenderer.js';

const BENCH_FLAG = 'chronicler_dev_sigma_bench';

/**
 * Returns true when the sigma WebGL benchmark overlay should replace the normal graph.
 * @returns {boolean}
 */
export function isSigmaBenchEnabled() {
  try { return localStorage.getItem(BENCH_FLAG) === '1'; } catch { return false; }
}

/**
 * Dev-only full-screen sigma.js benchmark (enable: localStorage chronicler_dev_sigma_bench = 1).
 * @param {{ onExit: () => void }} props
 */
export default function GraphSigmaBench({ onExit }) {
  const containerRef = useRef(null);
  const benchRef = useRef(null);
  const [nodeCount, setNodeCount] = useState(500);
  const [showLabels, setShowLabels] = useState(true);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    benchRef.current?.destroy();
    benchRef.current = mountSigmaBench(el, {
      nodeCount,
      showLabels,
      onFps: setFps,
    });
    return () => {
      benchRef.current?.destroy();
      benchRef.current = null;
    };
  }, [nodeCount, showLabels]);

  const edgeEst = Math.floor(nodeCount * 2.4);
  const score = graphSizeScore(nodeCount, edgeEst);
  const autoRenderer = selectGraphRenderer({ nodeCount, edgeCount: edgeEst });

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: '#07080e' }}>
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
      />
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, zIndex: 51,
        display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
        fontFamily: 'Cinzel, serif', fontSize: '10px', letterSpacing: '0.08em',
        color: 'rgba(226,213,187,0.9)',
        background: 'rgba(7,8,14,0.92)', border: '1px solid rgba(200,148,58,0.35)',
        borderRadius: '4px', padding: '10px 12px',
      }}>
        <span style={{ color: '#c8943a', fontWeight: 'bold' }}>Sigma WebGL spike</span>
        <span>{fps} FPS</span>
        <span>{nodeCount} nodes · ~{edgeEst} edges</span>
        <span>score {score.toFixed(0)} → auto: {autoRenderer}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Nodes
          <select
            value={nodeCount}
            onChange={e => setNodeCount(Number(e.target.value))}
            style={{
              background: '#0f1219', border: '1px solid rgba(200,148,58,0.3)', color: '#e2d5bb',
              fontFamily: 'Cinzel', fontSize: '10px', padding: '4px 8px', borderRadius: '3px',
            }}
          >
            {[100, 250, 500, 750, 1000].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={e => setShowLabels(e.target.checked)}
          />
          Labels
        </label>
        <button
          type="button"
          onClick={onExit}
          style={{
            marginLeft: 'auto', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em',
            padding: '6px 12px', borderRadius: '3px', cursor: 'pointer',
            background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', color: '#c8943a',
          }}
        >
          Exit bench
        </button>
      </div>
      <div style={{
        position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 51,
        fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.45)', letterSpacing: '0.06em',
      }}>
        Pan/zoom — nodes scale with zoom; labels use density culling (toggle off to measure raw FPS).
      </div>
    </div>
  );
}
