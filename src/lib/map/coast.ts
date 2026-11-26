import type { Graph } from './graph';
import type { NoisyEdges } from './noisy';

// Traces the coastline: every edge with land on one side and water on the other,
// chained into loops. Outside the map counts as water, so land touching the map's edge
// still makes a closed shape for filling; those map-edge pieces are left out of the
// coastline itself (no ink or waves along the map's border).

export interface CoastLine {
  /** x, y pairs. */
  pts: Float32Array;
  /** True when the line goes all the way around (an island or lake shore that never touches the map's edge). */
  closed: boolean;
}

export interface Coast {
  /** Closed loops around the land, for filling (draw with the even-odd rule: lakes are holes). */
  fill: Float32Array[];
  /** The coastline proper, for ink, shading and waves. */
  lines: CoastLine[];
}

export function buildCoast(g: Graph, land: Uint8Array, noisy: NoisyEdges): Coast {
  const vertexCount = g.vertices.length / 2;
  const isLand = (c: number) => (c >= 0 ? land[c] === 1 : false);
  const boundary = new Uint8Array(g.edgeCount);
  // Each vertex touches 0 or 2 boundary edges (3 cells meet at a vertex).
  const at0 = new Int32Array(vertexCount).fill(-1);
  const at1 = new Int32Array(vertexCount).fill(-1);
  const add = (v: number, e: number) => {
    if (at0[v] < 0) at0[v] = e;
    else at1[v] = e;
  };
  for (let e = 0; e < g.edgeCount; e++) {
    if (isLand(g.edges[e * 4 + 2]) === isLand(g.edges[e * 4 + 3])) continue;
    boundary[e] = 1;
    add(g.edges[e * 4], e);
    add(g.edges[e * 4 + 1], e);
  }

  const fill: Float32Array[] = [];
  const lines: CoastLine[] = [];
  const visited = new Uint8Array(g.edgeCount);
  for (let start = 0; start < g.edgeCount; start++) {
    if (!boundary[start] || visited[start]) continue;
    // Walk the loop: the edges in order, each with its direction.
    const loop: number[] = [];
    const forward: boolean[] = [];
    let e = start;
    let fwd = true;
    let guard = g.edgeCount + 1;
    while (guard-- > 0) {
      visited[e] = 1;
      loop.push(e);
      forward.push(fwd);
      const end: number = fwd ? g.edges[e * 4 + 1] : g.edges[e * 4];
      const next: number = at0[end] === e ? at1[end] : at0[end];
      if (next < 0 || next === start) break;
      fwd = g.edges[next * 4] === end;
      e = next;
    }

    const pieces = loop.map((edge, k) => {
      const p = noisy.get(edge);
      return forward[k] ? p : reversed(p);
    });
    fill.push(join(pieces));

    // Coastline runs: break the loop at map-edge pieces.
    const onBorder = loop.map((edge) => g.edges[edge * 4 + 3] < 0);
    const firstBorder = onBorder.indexOf(true);
    if (firstBorder < 0) {
      lines.push({ pts: join(pieces), closed: true });
      continue;
    }
    let run: Float32Array[] = [];
    for (let k = 1; k <= loop.length; k++) {
      const i = (firstBorder + k) % loop.length;
      if (onBorder[i]) {
        if (run.length) lines.push({ pts: join(run), closed: false });
        run = [];
      } else run.push(pieces[i]);
    }
    if (run.length) lines.push({ pts: join(run), closed: false });
  }
  return { fill, lines };
}

function reversed(p: Float32Array) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[i] = p[p.length - 2 - i];
    out[i + 1] = p[p.length - 1 - i];
  }
  return out;
}

/** Joins consecutive pieces, dropping the repeated point where each piece starts. */
function join(pieces: Float32Array[]) {
  let n = 0;
  for (let i = 0; i < pieces.length; i++) n += i === 0 ? pieces[i].length : pieces[i].length - 2;
  const out = new Float32Array(n);
  let at = 0;
  pieces.forEach((p, i) => {
    const from = i === 0 ? 0 : 2;
    out.set(p.subarray(from), at);
    at += p.length - from;
  });
  return out;
}
