/** Hop-based opacity tiers for selection / hover preview. */
export const HOP_OPACITY = [1.0, 1.0, 0.85, 0.6, 0.35, 0.18, 0.08];
export const FLOOR_OPACITY = 0.04;
/** While choosing the second node in Find Path, non-source nodes use this opacity (~35% dim vs full). */
export const PATH_FIND_PICK_DIM_OPACITY = 0.65;
export const MAX_HOPS = 6;
/** Disable hover tier preview above this node count — full-graph class churn is too costly. */
export const HOVER_HIGHLIGHT_MAX_NODES = 50;
/** Delay before hover tier halo appears (ms). */
export const HOVER_DELAY_MS = 450;
/** Duration for tier hover fade / node enlargement (ms). */
export const HOVER_TRANSITION_MS = 260;
/** Hide edge labels when zoomed out below this level. */
export const EDGE_LABEL_MIN_ZOOM = 0.42;
/** Hide node title labels when zoomed out below this level (keeps labels in the sharp zoom band). */
export const NODE_LABEL_MIN_ZOOM = 0.8;
/** Sweet-spot zoom band where labels should look crisp on retina displays. */
export const GRAPH_LABEL_SHARP_MIN_ZOOM = 0.8;
export const GRAPH_MIN_ZOOM = 0.1;
export const GRAPH_MAX_ZOOM = 1.5;
/** Canvas DPR at init — Cytoscape has no runtime pixelRatio setter. */
export const GRAPH_PIXEL_RATIO_CAP = 2;
/** Auto-route to WebGL renderer when node+edge score exceeds this (score = nodes + edges×0.5). Calibrated: 1000-node dev fixture ≈ 1662 and runs well on Standard. */
export const LARGE_GRAPH_SCORE_THRESHOLD = 2000;
/** Renderer preference localStorage suffix key part. */
export const GRAPH_RENDERER_PREF_KEY = 'chronicler_graph_renderer';
