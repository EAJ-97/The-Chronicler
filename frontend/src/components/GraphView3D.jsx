import { useEffect, useRef, useCallback, useState } from 'react';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { getCategoryColor } from './NoteEditor.jsx';

const N_SEG = 24;

const MAX_HOPS    = 6;
const FLOOR_OP    = 0.04;
/** Non-highlighted nodes/links while choosing the second Find Path node (~35% dim vs full). */
const PATH_PICK_DIM = 0.65;
const HOP_OPACITY = [1.0, 1.0, 0.85, 0.6, 0.35, 0.18, 0.08];

/**
 * True if this connection is canonical for pathfinding and hop highlighting (excludes theory/ship gimmick edges).
 * @param {{ connection_kind?: string, is_speculative?: number }} c
 * @returns {boolean}
 */
function isCanonConnection(c) {
  const k = c.connection_kind;
  if (k === 'theory' || k === 'ship') return false;
  if (k === 'canon') return true;
  return !c.is_speculative;
}

function buildTiers(startId, adjacency) {
  const tiers = new Map();
  if (!startId) return tiers;
  const queue = [[startId, 0]];
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (tiers.has(id)) continue;
    tiers.set(id, depth);
    (adjacency.get(id) || []).forEach(nbr => {
      if (!tiers.has(nbr)) queue.push([nbr, depth + 1]);
    });
  }
  return tiers;
}

function getAllShortestPaths3D(adjacency, srcId, tgtId, maxPaths = 3) {
  if (srcId === tgtId) return [];
  const dist    = new Map([[srcId, 0]]);
  const parents = new Map([[srcId, []]]);
  const queue   = [srcId];
  let   found   = false;

  while (queue.length) {
    const cur = queue.shift();
    const d   = dist.get(cur);
    if (cur === tgtId) { found = true; break; }
    (adjacency.get(cur) || []).forEach(nbr => {
      if (!dist.has(nbr)) {
        dist.set(nbr, d + 1);
        parents.set(nbr, [cur]);
        queue.push(nbr);
      } else if (dist.get(nbr) === d + 1) {
        parents.get(nbr).push(cur);
      }
    });
  }

  if (!found) return [];
  const paths = [];
  const stack = [[tgtId, [tgtId]]];
  while (stack.length && paths.length < maxPaths) {
    const [node, path] = stack.pop();
    if (node === srcId) { paths.push([...path].reverse()); continue; }
    for (const p of (parents.get(node) || [])) stack.push([p, [...path, p]]);
  }
  return paths;
}

function makeLinkMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time:    { value: 0 },
      opacity: { value: 1.0 },
      start:   { value: new THREE.Vector3() },
      end:     { value: new THREE.Vector3() },
    },
    vertexShader: `
      attribute float aT;
      varying float vT;
      void main() {
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float opacity;
      varying float vT;
      void main() {
        float phase = sin(time * 0.5) * 0.5 + 0.5;
        float dist  = abs(vT - phase);
        float glow  = exp(-dist * dist * 5.0);
        vec3 base   = vec3(0.32, 0.22, 0.06);
        vec3 bright = vec3(0.90, 0.68, 0.22);
        float alpha = (0.28 + glow * 0.80) * opacity;
        gl_FragColor = vec4(mix(base, bright, glow), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function makeLinkLine() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((N_SEG + 1) * 3);
  const tValues   = new Float32Array(N_SEG + 1);
  for (let i = 0; i <= N_SEG; i++) tValues[i] = i / N_SEG;
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aT',       new THREE.BufferAttribute(tValues, 1));
  return new THREE.Line(geo, makeLinkMaterial());
}

function makeD20(radius, hexColor, narrativeWeight) {
  const color = new THREE.Color(hexColor);
  const group = new THREE.Group();

  // Detail nodes start at reduced opacity
  const baseOpacity = narrativeWeight === 'detail' ? 0.55 : 1.0;

  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: narrativeWeight === 'landmark' ? 0.38 : 0.22,
    metalness: 0.35,
    roughness: 0.45,
    flatShading: true,
    transparent: baseOpacity < 1,
    opacity: baseOpacity,
  });
  group.add(new THREE.Mesh(geo, mat));

  // Edge lines
  const edgesMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(hexColor).lerp(new THREE.Color(0xffffff), 0.5),
    transparent: true,
    opacity: narrativeWeight === 'detail' ? 0.25 : 0.55,
  });
  group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius * 1.002, 0)),
    edgesMat
  ));

  // Glow shell
  const glowMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: narrativeWeight === 'detail' ? 0.03 : 0.08,
    side: THREE.BackSide,
  });
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.25, 1), glowMat));

  // Landmark: add a rotating outer ring
  if (narrativeWeight === 'landmark') {
    const ringGeo = new THREE.TorusGeometry(radius * 1.7, 0.4, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hexColor).lerp(new THREE.Color(0xffffff), 0.3),
      transparent: true,
      opacity: 0.45,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.userData.isLandmarkRing = true;
    group.add(ring);

    // Second ring, tilted 60°
    const ring2 = ring.clone();
    ring2.rotation.x = Math.PI / 3;
    ring2.userData.isLandmarkRing = true;
    group.add(ring2);
  }

  group.userData.coreMat = mat;
  group.userData.edgeMat = edgesMat;
  group.userData.glowMat = glowMat;
  group.userData.narrativeWeight = narrativeWeight;
  group.userData.baseOpacity = baseOpacity;

  return group;
}

function makeLabel(text, yOffset, nodeRadius) {
  const maxChars = 22;
  const displayText = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;

  const canvas = document.createElement('canvas');
  canvas.width  = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Shadow for legibility against any background
  ctx.shadowColor   = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  ctx.font      = 'bold 42px sans-serif';
  ctx.fillStyle = 'rgba(226,213,187,1.0)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, 512, 64);

  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthTest: false,      // always draw on top — never occluded
    depthWrite: false,
    sizeAttenuation: true, // scale in world units so it shrinks naturally with distance
  });
  const sprite = new THREE.Sprite(mat);
  // Scale proportional to node — wide enough to fit the text clearly
  const w = nodeRadius * 7;
  sprite.scale.set(w, w * 0.14, 1);
  sprite.position.set(0, yOffset, 0);
  sprite.userData.isLabel = true;
  return sprite;
}

const TIER_PARAMS = HOP_OPACITY.map((nodeOp, i) => ({
  nodeOp,
  emissive: [0.22, 0.20, 0.14, 0.09, 0.05, 0.02, 0.01][i],
  edgeOp:   [0.55, 0.50, 0.38, 0.22, 0.12, 0.05, 0.02][i],
  glowOp:   [0.08, 0.07, 0.05, 0.03, 0.02, 0.01, 0.01][i],
  linkOp:   [1.0,  0.85, 0.65, 0.40, 0.22, 0.10, 0.05][i],
  labelOp:  [1.0,  0.90, 0.70, 0.45, 0.25, 0.12, 0.06][i],
}));

export default function GraphView3D({ notes, connections, onSelectNote, onOpenNote, connectMode, onExitConnectMode, onCreateConnection, activeCampaignId, pathMode: pathModeProp = false, pathSource: pathSourceProp = null, onPathSourceSet, onPathResult, onExitPathMode, isMobile = false, tutorialRefs = null }) {
  const mountRef         = useRef(null);
  const graphRef         = useRef(null);
  const lastClickRef     = useRef({ id: null, time: 0 });
  const linkLinesRef     = useRef([]); // { line, src, tgt }
  const nodeMeshesRef    = useRef(new Map());
  const adjacencyRef     = useRef(new Map());
  const hoveredRef       = useRef(null);
  const displayHoveredRef = useRef(null);
  const hoverDelayTimer  = useRef(null);
  const rafRef           = useRef(null);
  const startTimeRef     = useRef(performance.now());
  const dataFingerprintRef = useRef('');
  const applyForcesRef = useRef(null);
  const connectModeRef   = useRef(connectMode);
  const connectSourceRef = useRef(null);
  connectModeRef.current = connectMode;
  const pathModeRef      = useRef(false);
  const pathSourceRef    = useRef(null);
  const pathDataRef      = useRef(null);
  // Sync refs from parent-controlled props
  pathModeRef.current   = pathModeProp;
  pathSourceRef.current = pathSourceProp;
  const onSelectNoteRef     = useRef(onSelectNote);
  const onOpenNoteRef       = useRef(onOpenNote);
  const onCreateConnectionRef = useRef(onCreateConnection);
  const onExitConnectModeRef  = useRef(onExitConnectMode);
  onSelectNoteRef.current       = onSelectNote;
  onOpenNoteRef.current         = onOpenNote;
  onCreateConnectionRef.current = onCreateConnection;
  onExitConnectModeRef.current  = onExitConnectMode;

  useEffect(() => {
    if (!connectMode) connectSourceRef.current = null;
    if (connectMode) { pathDataRef.current = null; onExitPathMode?.(); }
  }, [connectMode]);

  useEffect(() => {
    if (!pathModeProp) pathDataRef.current = null;
  }, [pathModeProp]);

  const exitPathMode = () => {
    pathDataRef.current = null;
    onExitPathMode?.();
  };

  const buildGraphData = useCallback(() => {
    const nodeIds = new Set(notes.map(n => String(n.id)));
    return {
      nodes: notes.map(n => ({
        id: String(n.id), name: n.title,
        category: n.category, isFolder: !!n.is_folder,
        significance: n.significance || 'standard',
        narrativeWeight: n.narrative_weight || 'node',
        val: n.is_folder ? 6 : (n.significance === 'major' ? 8 : n.significance === 'minor' ? 2 : 4),
      })),
      links: connections
        .filter(c => nodeIds.has(String(c.source_note_id)) && nodeIds.has(String(c.target_note_id)))
        .map(c => ({
          source: String(c.source_note_id),
          target: String(c.target_note_id),
        })),
    };
  }, [notes, connections]);

  const rebuildAdj = useCallback(() => {
    const adj = new Map();
    connections.forEach(c => {
      if (!isCanonConnection(c)) return;
      const s = String(c.source_note_id), t = String(c.target_note_id);
      if (!adj.has(s)) adj.set(s, []);
      if (!adj.has(t)) adj.set(t, []);
      adj.get(s).push(t); adj.get(t).push(s);
    });
    adjacencyRef.current = adj;
  }, [connections]);

  useEffect(() => { rebuildAdj(); }, [rebuildAdj]);

  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    linkLinesRef.current  = [];
    nodeMeshesRef.current = new Map();

    const fg = ForceGraph3D({ antialias: true })(el)
      .width(el.clientWidth || 800)
      .height(el.clientHeight || 600)
      .backgroundColor('#07080e')
      .showNavInfo(false)
      .nodeLabel(() => '') // suppress built-in tooltip — we use sprite labels

      .nodeThreeObject(node => {
        const color  = node.isFolder ? '#c8943a' : getCategoryColor(node.category);
        const baseR  = node.isFolder ? 14 : (node.significance === 'major' ? 18 : node.significance === 'minor' ? 7 : 12);
        const nw     = node.narrativeWeight || 'node';
        const group  = makeD20(baseR, color, nw);
        group.add(makeLabel(node.name, baseR + 8, baseR));
        group.userData.nodeId = node.id;
        nodeMeshesRef.current.set(node.id, group);
        return group;
      })
      .nodeThreeObjectExtend(false)

      // Use custom line objects — update positions manually in RAF loop
      .linkThreeObject(link => {
        const line = makeLinkLine();
        const src = typeof link.source === 'object' ? link.source.id : String(link.source);
        const tgt = typeof link.target === 'object' ? link.target.id : String(link.target);
        line.userData.src = src;
        line.userData.tgt = tgt;
        linkLinesRef.current.push(line);
        return line;
      })
      // Tell force-graph NOT to position these links (we do it in RAF)
      .linkPositionUpdate(() => true)
      .linkWidth(0) // hide default link — we draw our own

      .onNodeHover(node => {
        hoveredRef.current = node ? node.id : null;
        el.style.cursor = connectModeRef.current ? 'crosshair' : (node ? 'pointer' : 'default');
        clearTimeout(hoverDelayTimer.current);
        if (node) {
          hoverDelayTimer.current = setTimeout(() => { displayHoveredRef.current = node.id; }, 200);
        } else {
          displayHoveredRef.current = null;
        }
      })
      .onNodeClick((node, event) => {
        // Only fire on left click — ignore middle/right
        if (event && event.button !== 0) return;
        if (connectModeRef.current) {
          const src = connectSourceRef.current;
          if (!src) {
            connectSourceRef.current = { id: node.id, title: node.name };
          } else if (src.id !== node.id) {
            onCreateConnectionRef.current(parseInt(src.id), parseInt(node.id));
            connectSourceRef.current = null;
            onExitConnectModeRef.current();
          }
          return;
        }
        if (pathModeRef.current) {
          const id = node.id, name = node.name;
          if (!pathSourceRef.current) {
            onPathSourceSet?.({ id, name });
            pathDataRef.current = { nodeIds: new Set([id]), edgePairs: new Set(), sourceOnly: true };
          } else {
            const srcId = pathSourceRef.current.id;
            if (srcId === id) return;
            const paths = getAllShortestPaths3D(adjacencyRef.current, srcId, id, 3);
            if (paths.length === 0) {
              onPathResult?.({ found: false, paths: [] });
              pathDataRef.current = { nodeIds: new Set([srcId, id]), edgePairs: new Set(), noPath: true };
            } else {
              onPathResult?.({ found: true, paths });
              const nodeIds = new Set();
              const edgePairs = new Set();
              paths.forEach(path => {
                path.forEach(nid => nodeIds.add(nid));
                for (let i = 0; i < path.length - 1; i++) {
                  const a = path[i], b = path[i + 1];
                  edgePairs.add([a, b].sort().join('_'));
                }
              });
              pathDataRef.current = { nodeIds, edgePairs };
            }
          }
          return;
        }
        const now = Date.now(), last = lastClickRef.current;
        if (last.id === node.id && now - last.time < 400) {
          onOpenNoteRef.current(parseInt(node.id));
          lastClickRef.current = { id: null, time: 0 };
        } else {
          onSelectNoteRef.current(parseInt(node.id));
          lastClickRef.current = { id: node.id, time: now };
        }
      })
      .graphData(buildGraphData())
      .d3AlphaDecay(0.008)      // very slow decay — sim keeps adjusting gently forever
      .d3VelocityDecay(0.25);   // low friction so nodes drift fluidly

    // Build degree map so forces can be weighted by connection count
    const applyWeightedForces = () => {
      const degMap = new Map();
      const gData  = fg.graphData();
      gData.nodes.forEach(n => degMap.set(n.id, 0));
      gData.links.forEach(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        degMap.set(s, (degMap.get(s) || 0) + 1);
        degMap.set(t, (degMap.get(t) || 0) + 1);
      });

      // Link force: asymmetric — the LESS connected end gets pulled harder.
      // A satellite (deg 1) connected to a hub (deg 8) is strongly attracted;
      // the hub barely feels the pull so it stays anchored.
      const linkForce = fg.d3Force('link');
      if (linkForce) {
        linkForce
          .distance(link => {
            const s = typeof link.source === 'object' ? link.source.id : link.source;
            const t = typeof link.target === 'object' ? link.target.id : link.target;
            const maxDeg = Math.max(degMap.get(s) || 0, degMap.get(t) || 0);
            // Pairs involving a hub sit close; equal-degree pairs stay moderate
            return Math.max(18, 60 - maxDeg * 5);
          })
          .strength(link => {
            const s = typeof link.source === 'object' ? link.source.id : link.source;
            const t = typeof link.target === 'object' ? link.target.id : link.target;
            const sDeg = degMap.get(s) || 0;
            const tDeg = degMap.get(t) || 0;
            const minDeg = Math.min(sDeg, tDeg);
            // Weaker end drives the strength — low-degree node is pulled hardest
            return 0.08 + (1 / (minDeg + 1)) * 0.25;
          });
      }

      // Charge: global gentle repulsion, scaled up per-node by local crowding.
      // We approximate "nearby nodes" by degree — highly connected nodes already
      // have many neighbors, so they get stronger outward push to avoid pile-ups.
      // forceCollide handles actual overlap prevention.
      const chargeForce = fg.d3Force('charge');
      if (chargeForce) {
        chargeForce.strength(node => {
          const deg = degMap.get(node.id) || 0;
          // Base repulsion + extra push for nodes that have many neighbors nearby
          return -(20 + deg * 12);
        });
      }

      // Collision force: proper callable function with initialize method attached
      const collideForce = function(alpha) {
        const nodes = collideForce._nodes;
        if (!nodes) return;
        const n = nodes.length;
        const radius = node => {
          const sig = node.significance || 'standard';
          return sig === 'major' ? 22 : sig === 'minor' ? 10 : 16;
        };
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = (b.x || 0) - (a.x || 0);
            const dy = (b.y || 0) - (a.y || 0);
            const dz = (b.z || 0) - (a.z || 0);
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
            const minDist = radius(a) + radius(b) + 8;
            if (dist < minDist) {
              const force = ((minDist - dist) / dist) * alpha * 0.6;
              const fx = dx * force, fy = dy * force, fz = dz * force;
              a.vx = (a.vx || 0) - fx; a.vy = (a.vy || 0) - fy; a.vz = (a.vz || 0) - fz;
              b.vx = (b.vx || 0) + fx; b.vy = (b.vy || 0) + fy; b.vz = (b.vz || 0) + fz;
            }
          }
        }
      };
      collideForce.initialize = nodes => { collideForce._nodes = nodes; };
      fg.d3Force('collide', collideForce);
    };

    applyWeightedForces();
    applyForcesRef.current = applyWeightedForces;

    // Seed node positions in a 3D sphere so the sim never starts flat
    // Only for nodes without existing xyz (brand new load)
    const spread = 120;
    fg.graphData().nodes.forEach(n => {
      if (n.x === undefined || n.x === 0) {
        // Fibonacci sphere distribution for even initial spread
        const phi   = Math.acos(1 - 2 * Math.random());
        const theta = 2 * Math.PI * Math.random();
        n.x = spread * Math.sin(phi) * Math.cos(theta) * (0.5 + Math.random());
        n.y = spread * Math.sin(phi) * Math.sin(theta) * (0.5 + Math.random());
        n.z = spread * Math.cos(phi)                   * (0.5 + Math.random());
      }
    });

    // Lighting
    const scene = fg.scene();
    const key = new THREE.DirectionalLight(0xfff4e0, 1.4);
    key.position.set(200, 200, 100);
    const fill = new THREE.DirectionalLight(0x8090ff, 0.5);
    fill.position.set(-200, -100, -100);
    scene.add(key, fill, new THREE.AmbientLight(0x111122, 2.0));
    graphRef.current = fg;

    // Remap mouse/touch controls
    const controls = fg.controls();
    controls.mouseButtons.LEFT    = THREE.MOUSE.PAN;
    controls.mouseButtons.MIDDLE  = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT   = THREE.MOUSE.ROTATE;
    controls.touches.ONE          = THREE.TOUCH.ROTATE;
    controls.touches.TWO          = THREE.TOUCH.DOLLY_PAN; // pinch=zoom, 2-finger drag=pan
    controls.enablePan            = true;
    controls.screenSpacePanning   = true; // pan moves camera+target parallel to screen → orbit center follows the view
    controls.minDistance          = 5;
    controls.maxDistance          = 12000;
    controls.enableDamping        = false;
    controls.enableZoom           = true; // allows touch pinch; wheel is intercepted by our handler below

    // Overlay div — becomes pointer-events:all during middle drag to block node interaction
    const blocker = document.createElement('div');
    blocker.style.cssText = 'position:absolute;inset:0;z-index:9;display:none;cursor:grab;';
    el.style.position = 'relative';
    el.appendChild(blocker);

    const camera     = fg.camera();
    let middleDragging = false;

    // After the force sim settles, re-center the orbit target on the graph centroid.
    // This ensures rotation orbits the actual cluster, not the world origin.
    const centroidTimer = setTimeout(() => {
      const nodes = fg.graphData().nodes;
      if (!nodes.length) return;
      let cx = 0, cy = 0, cz = 0;
      nodes.forEach(n => { cx += (n.x || 0); cy += (n.y || 0); cz += (n.z || 0); });
      cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
      const centroid = new THREE.Vector3(cx, cy, cz);
      // Shift camera by the same delta so the view doesn't jump
      const delta = centroid.clone().sub(controls.target);
      camera.position.add(delta);
      controls.target.copy(centroid);
      zoomTarget = camera.position.distanceTo(controls.target);
      controls.update();
    }, 2000);

    // Smooth zoom — stop wheel reaching OrbitControls, handle manually
    let zoomTarget = camera.position.distanceTo(controls.target);
    const _onWheel = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // prevents OrbitControls from also handling it
      const factor = e.deltaY > 0 ? 1.08 : 0.93;
      zoomTarget = Math.min(Math.max(zoomTarget * factor, controls.minDistance), controls.maxDistance);
    };
    el.addEventListener('wheel', _onWheel, { passive: false, capture: true });
    el._onWheel = _onWheel;

    const _onPointerDown = (e) => {
      if (e.button !== 1) return;
      middleDragging        = true;
      blocker.style.display = 'block'; // absorbs all pointer events → nodes can't be grabbed
    };
    const _onPointerUp = (e) => {
      if (e.button !== 1) return;
      middleDragging        = false;
      blocker.style.display = 'none';
    };
    el.addEventListener('pointerdown', _onPointerDown);
    el.addEventListener('pointerup',   _onPointerUp);
    el._onPointerDown = _onPointerDown;
    el._onPointerUp   = _onPointerUp;

    // RAF loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const t = (performance.now() - startTimeRef.current) / 1000;

      // Smooth zoom — lerp camera distance toward zoomTarget each frame
      const dir     = camera.position.clone().sub(controls.target).normalize();
      const curDist = camera.position.distanceTo(controls.target);
      const diff    = zoomTarget - curDist;
      if (Math.abs(diff) > 0.1) {
        camera.position.copy(controls.target).addScaledVector(dir, curDist + diff * 0.12);
      }
      controls.update();

      // Update link line positions from current node coords + shader time
      const gData = fg.graphData();
      const nodePos = new Map();
      (gData.nodes || []).forEach(n => {
        if (n.x !== undefined) nodePos.set(String(n.id), { x: n.x, y: n.y, z: n.z });
      });

      linkLinesRef.current.forEach(line => {
        const s = nodePos.get(line.userData.src);
        const e = nodePos.get(line.userData.tgt);
        if (!s || !e) return;
        const pos = line.geometry.attributes.position.array;
        for (let i = 0; i <= N_SEG; i++) {
          const f = i / N_SEG;
          pos[i*3]   = s.x + (e.x - s.x) * f;
          pos[i*3+1] = s.y + (e.y - s.y) * f;
          pos[i*3+2] = s.z + (e.z - s.z) * f;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.material.uniforms.time.value = t;
      });

      // Path mode overrides hover dimming entirely
      const pathData = pathDataRef.current;
      const hovered  = pathData ? null : displayHoveredRef.current;
      const tiers    = hovered ? buildTiers(hovered, adjacencyRef.current) : null;

      nodeMeshesRef.current.forEach((group, nodeId) => {
        const nw = group.userData.narrativeWeight || 'node';
        const isLandmark = nw === 'landmark';
        const isDetail   = nw === 'detail';

        // Rotate landmark rings always
        group.children.forEach(c => {
          if (c.userData?.isLandmarkRing) {
            c.rotation.y = t * 0.4;
            c.rotation.z = t * 0.25;
          }
        });

        const { coreMat, edgeMat, glowMat } = group.userData;
        const detailMult = isDetail ? 0.55 : 1.0;

        let p, floorMult;
        if (pathData) {
          const onPath = pathData.nodeIds.has(nodeId);
          p         = TIER_PARAMS[0];
          const offDim = pathData.sourceOnly ? PATH_PICK_DIM : FLOOR_OP;
          floorMult = onPath ? 1.0 : offDim;
        } else {
          const rawDepth = tiers ? tiers.get(nodeId) : 0;
          const isFloor  = tiers && rawDepth === undefined;
          p         = TIER_PARAMS[isFloor ? 0 : Math.min(rawDepth ?? 0, MAX_HOPS)];
          floorMult = isFloor ? FLOOR_OP : 1.0;
        }

        if (coreMat) {
          coreMat.opacity = p.nodeOp * detailMult * floorMult;
          coreMat.transparent = true;
          coreMat.emissiveIntensity = (isLandmark ? 0.38 : p.emissive) * detailMult * floorMult;
        }
        if (edgeMat) { edgeMat.opacity = p.edgeOp * detailMult * floorMult; }
        if (glowMat) { glowMat.opacity = p.glowOp * detailMult * floorMult; }
        group.children.forEach(c => {
          if (c.userData?.isLabel && c.material) c.material.opacity = p.labelOp * detailMult * floorMult;
          if (c.userData?.isLandmarkRing && c.material) c.material.opacity = 0.45 * detailMult * floorMult;
        });
      });

      linkLinesRef.current.forEach(line => {
        if (pathData) {
          const pair = [line.userData.src, line.userData.tgt].sort().join('_');
          const onPath = pathData.edgePairs.has(pair);
          const offOpacity = pathData.sourceOnly ? PATH_PICK_DIM : FLOOR_OP;
          line.material.uniforms.opacity.value = onPath ? 1.0 : offOpacity;
        } else if (!tiers) {
          line.material.uniforms.opacity.value = TIER_PARAMS[0].linkOp;
        } else {
          const sDepth = tiers.get(line.userData.src);
          const tDepth = tiers.get(line.userData.tgt);
          if (sDepth === undefined || tDepth === undefined) {
            line.material.uniforms.opacity.value = FLOOR_OP;
          } else {
            const depth = Math.min(Math.max(sDepth, tDepth), MAX_HOPS);
            line.material.uniforms.opacity.value = TIER_PARAMS[depth].linkOp;
          }
        }
      });
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (graphRef.current && el) graphRef.current.width(el.clientWidth).height(el.clientHeight);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      clearTimeout(hoverDelayTimer.current);
      clearTimeout(centroidTimer);
      if (el._onWheel)       el.removeEventListener('wheel',       el._onWheel, { capture: true });
      if (el._onPointerDown) el.removeEventListener('pointerdown', el._onPointerDown);
      if (el._onPointerUp)   el.removeEventListener('pointerup',   el._onPointerUp);
      if (blocker.parentNode) blocker.parentNode.removeChild(blocker);
      linkLinesRef.current = [];
      nodeMeshesRef.current = new Map();
      try { graphRef.current?._destructor?.(); } catch (e) {}
      graphRef.current = null;
      el.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    // Only update graph when actual content changes — not just new array references
    // This prevents the graph from resetting layout on every Dashboard re-render
    const fp = notes.map(n => `${n.id}:${n.title}:${n.category}:${n.significance}:${n.narrative_weight}`)
                    .concat(connections.map(c => `${c.source_note_id}-${c.target_note_id}`))
                    .join('|');
    if (fp === dataFingerprintRef.current) return;
    dataFingerprintRef.current = fp;
    if (!graphRef.current) return;
    linkLinesRef.current  = [];
    nodeMeshesRef.current = new Map();
    graphRef.current.graphData(buildGraphData());
    rebuildAdj();
    // Re-apply weighted forces with updated degree map after data change
    applyForcesRef.current?.();
  }, [notes, connections]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Right slide-out controls panel */}
      <ControlsPanel isMobile={isMobile} tutorialRefs={tutorialRefs} />

      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.35)', pointerEvents: 'none' }}>
        {notes.length} nodes · {connections.length} connections
      </div>
    </div>
  );
}

function ControlsPanel({ isMobile = false, tutorialRefs = null }) {
  const [open, setOpen] = useState(false);

  const desktopControls = [
    { key: 'LEFT CLICK',          desc: 'Select node' },
    { key: 'LEFT DRAG',          desc: 'Pan view' },
    { key: 'MIDDLE / RIGHT DRAG', desc: 'Rotate view' },
    { key: 'SCROLL',             desc: 'Zoom in / out' },
    { key: 'DOUBLE-CLICK',       desc: 'Open editor' },
  ];

  const mobileControls = [
    { key: 'TAP',           desc: 'Select node' },
    { key: 'DOUBLE-TAP',    desc: 'Open editor' },
    { key: '1 FINGER DRAG', desc: 'Rotate view' },
    { key: 'PINCH',         desc: 'Zoom in / out' },
    { key: '2 FINGER DRAG', desc: 'Pan view' },
  ];

  const items = isMobile ? mobileControls : desktopControls;

  return (
    <div ref={tutorialRefs?.controls3d || null} style={{
      position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
      zIndex: 10, display: 'flex', alignItems: 'stretch', pointerEvents: 'none',
    }}>
      {/* Tab */}
      <button
        ref={tutorialRefs?.controls3dTab || null}
        onClick={() => setOpen(o => !o)}
        style={{
          pointerEvents: 'all',
          background: 'rgba(7,8,14,0.92)', border: '1px solid rgba(200,148,58,0.3)',
          borderRight: open ? '1px solid rgba(200,148,58,0.15)' : '1px solid rgba(200,148,58,0.3)',
          borderRadius: '6px 0 0 6px',
          cursor: 'pointer', padding: '10px 6px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '3px', color: 'rgba(200,148,58,0.65)', flexShrink: 0,
          backdropFilter: 'blur(10px)',
        }}
        title={open ? 'Close controls' : 'Open controls'}
      >
        <span style={{ fontSize: '10px', marginBottom: '4px' }}>{open ? '»' : '«'}</span>
        <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.05em', writingMode: 'vertical-rl', textOrientation: 'mixed', color: 'rgba(200,148,58,0.65)' }}>CONTROLS</span>
      </button>

      {/* Sliding panel */}
      <div style={{
        pointerEvents: 'all',
        background: 'rgba(7,8,14,0.92)', border: '1px solid rgba(200,148,58,0.3)',
        borderRight: 'none', borderRadius: '6px 0 0 6px',
        padding: open ? '14px 16px' : '0',
        width: open ? '180px' : '0',
        overflow: 'hidden',
        transition: 'width 0.22s ease, padding 0.22s ease',
        backdropFilter: 'blur(10px)',
        flexShrink: 0,
      }}>
        <div style={{ width: '160px' }}>
          <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '10px' }}>3D CONTROLS</div>
          {items.map(({ key, desc }) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.7)' }}>{key}</span>
              <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.65)', marginTop: '1px' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
