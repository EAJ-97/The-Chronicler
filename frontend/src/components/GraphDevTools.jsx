import { useState } from 'react';
import { LARGE_GRAPH_SCORE_THRESHOLD } from '../graph/constants.js';

const panelStyle = {
  position: 'absolute',
  top: 52,
  left: 12,
  zIndex: 55,
  maxWidth: 'min(420px, calc(100% - 24px))',
  fontFamily: 'Cinzel, serif',
  fontSize: '9px',
  letterSpacing: '0.08em',
  color: 'rgba(226,213,187,0.92)',
  background: 'rgba(7,8,14,0.94)',
  border: '1px solid rgba(58,196,120,0.45)',
  borderRadius: '4px',
  boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
};

const btnBase = {
  fontFamily: 'Cinzel',
  fontSize: '8px',
  letterSpacing: '0.1em',
  padding: '5px 8px',
  borderRadius: '3px',
  cursor: 'pointer',
  border: '1px solid rgba(200,148,58,0.25)',
  background: 'rgba(200,148,58,0.08)',
  color: 'rgba(200,148,58,0.75)',
};

/**
 * Active-state style for a toggle button in the dev graph panel.
 * @param {boolean} active
 * @returns {object}
 */
function activeBtn(active) {
  return active
    ? { ...btnBase, background: 'rgba(58,196,120,0.18)', border: '1px solid rgba(58,196,120,0.5)', color: 'rgba(160,240,190,0.95)' }
    : btnBase;
}

/**
 * Dev-only graph test controls (port 3002). Map engine override, synthetic graphs, sigma bench.
 * @param {object} props
 * @param {'auto'|'cytoscape'|'webgl'} props.rendererPref
 * @param {'cytoscape'|'webgl'} props.activeEngine
 * @param {boolean} props.fixtureActive - synthetic notes replace campaign graph
 * @param {number} props.nodeCount
 * @param {number} props.edgeCount
 * @param {number} props.graphScore
 * @param {number} props.scoreThreshold - effective auto-WebGL threshold
 * @param {(pref: 'auto'|'cytoscape'|'webgl') => void} props.onSetRendererPref
 * @param {(threshold: number|null) => void} props.onSetScoreThreshold
 * @param {(nodeCount: number) => void} props.onLoadFixture
 * @param {() => void} props.onClearFixture
 * @param {() => void} props.onOpenSigmaBench
 */
export default function GraphDevTools({
  rendererPref,
  activeEngine,
  fixtureActive,
  nodeCount,
  edgeCount,
  graphScore,
  scoreThreshold,
  onSetRendererPref,
  onSetScoreThreshold,
  onLoadFixture,
  onClearFixture,
  onOpenSigmaBench,
}) {
  const [open, setOpen] = useState(true);

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...btnBase,
          width: '100%',
          textAlign: 'left',
          border: 'none',
          borderBottom: open ? '1px solid rgba(58,196,120,0.25)' : 'none',
          borderRadius: open ? '4px 4px 0 0' : '4px',
          background: 'rgba(58,196,120,0.12)',
          color: 'rgba(160,240,190,0.95)',
          padding: '8px 10px',
        }}
      >
        {open ? '▾' : '▸'} DEV GRAPH TOOLS
        {!open && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            {nodeCount}n · score {graphScore.toFixed(0)} · {activeEngine}
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ opacity: 0.75, lineHeight: 1.5 }}>
            {fixtureActive ? 'Synthetic benchmark graph' : 'Campaign graph'}
            {' · '}
            {nodeCount} nodes · {edgeCount} edges · score {graphScore.toFixed(1)}
            {' · '}
            active: <strong style={{ color: '#8bc4e2' }}>{activeEngine}</strong>
          </div>

          <div>
            <div style={{ marginBottom: 5, color: 'rgba(200,148,58,0.55)', fontSize: '7px' }}>MAP ENGINE</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" style={activeBtn(rendererPref === 'auto')} onClick={() => onSetRendererPref('auto')}>
                Auto ({activeEngine})
              </button>
              <button type="button" style={activeBtn(rendererPref === 'cytoscape')} onClick={() => onSetRendererPref('cytoscape')}>
                Standard
              </button>
              <button type="button" style={activeBtn(rendererPref === 'webgl')} onClick={() => onSetRendererPref('webgl')}>
                Performance
              </button>
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 5, color: 'rgba(200,148,58,0.55)', fontSize: '7px' }}>
              AUTO SWITCH THRESHOLD (score ≥ picks WebGL)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button
                type="button"
                style={activeBtn(scoreThreshold === LARGE_GRAPH_SCORE_THRESHOLD && rendererPref === 'auto')}
                onClick={() => onSetScoreThreshold(null)}
                title={`Production default: ${LARGE_GRAPH_SCORE_THRESHOLD}`}
              >
                Prod ({LARGE_GRAPH_SCORE_THRESHOLD})
              </button>
              <button
                type="button"
                style={activeBtn(scoreThreshold === 40)}
                onClick={() => onSetScoreThreshold(40)}
                title="Sunken Vale (~40) auto-switches to WebGL"
              >
                Demo (40)
              </button>
              <button
                type="button"
                style={activeBtn(scoreThreshold === 80)}
                onClick={() => onSetScoreThreshold(80)}
              >
                Mid (80)
              </button>
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 5, color: 'rgba(200,148,58,0.55)', fontSize: '7px' }}>
              SYNTHETIC GRAPH (replaces canvas data; uses real renderer path)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {[100, 250, 500, 1000].map((n) => (
                <button key={n} type="button" style={btnBase} onClick={() => onLoadFixture(n)}>
                  {n} nodes
                </button>
              ))}
              {fixtureActive && (
                <button
                  type="button"
                  style={{ ...btnBase, border: '1px solid rgba(220,100,100,0.4)', color: 'rgba(255,180,180,0.9)' }}
                  onClick={onClearFixture}
                >
                  Clear → campaign
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 5, color: 'rgba(200,148,58,0.55)', fontSize: '7px' }}>ISOLATED SIGMA BENCH</div>
            <button type="button" style={btnBase} onClick={onOpenSigmaBench}>
              Full-screen WebGL spike…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
