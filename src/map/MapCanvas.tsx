import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getMap, onMapChange } from '../lib/store';
import type { SlotLook } from '../lib/map/biomes';
import { cellOutline } from '../lib/map/cells';
import { buildCoast, type Coast } from '../lib/map/coast';
import { cellAt, type Graph } from '../lib/map/graph';
import { iconBox, iconHit, minPixels, onSpritesReady, placeIcons, placementLook, variantsOf, type Placement } from '../lib/map/icons';
import { NoisyEdges } from '../lib/map/noisy';
import { riverAt, riverShapes, riverWaterfalls, routeRiver, simplify, snapToRivers, underRivers } from '../lib/map/rivers';
import type { Brush, MapPainter } from '../lib/map/paint';
import { MapRenderer, type MapStyle, type View } from '../lib/map/render';
import { computeHeights, underTerrain } from '../lib/map/terrain';
import type { PlacedIcon, River } from '../lib/world/types';

export type Tool = 'brush' | 'fill' | 'hand';
/** In Icons mode: place new icons, or select any icon (the app's own ones included). */
export type IconTool = 'place' | 'select';
/** In Rivers mode: draw a river by hand, click a source to route one downhill, or select one. */
export type RiverTool = 'draw' | 'route' | 'select';

/** What is under the cursor: map position (map units), the cell, and what is there. */
export interface Hover {
  x: number;
  y: number;
  cell: number;
  land: boolean;
  /** Biome slot (0 = none). */
  biomeSlot: number;
  /** Final elevation in meters (land only). */
  elevation: number;
}

export interface MapCanvasHandle {
  fit: () => void;
}

interface Props {
  handle: Ref<MapCanvasHandle>;
  graph: Graph;
  seed: number;
  style: MapStyle;
  looks: (SlotLook | null)[];
  placed: PlacedIcon[];
  /** Keys of the app's own icons that were taken over (MapInfo.hiddenAuto). */
  hiddenAuto: string[];
  overlay: boolean;
  /** Icons mode: clicks place and select icons instead of painting. */
  iconMode: boolean;
  iconTool: IconTool;
  rivers: River[];
  /** Rivers mode: clicks draw, route and select rivers instead of painting. */
  riverMode: boolean;
  riverTool: RiverTool;
  selectedRiver: string | null;
  /** A new river: its points from source to mouth, in map units. */
  onAddRiver: (points: [number, number][]) => void;
  onSelectRiver: (id: string | null) => void;
  selectedIcon: string | null;
  brush: Brush;
  tool: Tool;
  painter: MapPainter;
  onHover: (h: Hover | null) => void;
  onPick: (h: Hover) => void;
  onZoom: (scale: number) => void;
  onPlaceIcon: (x: number, y: number) => void;
  onSelectIcon: (id: string | null) => void;
  onMoveIcon: (id: string, x: number, y: number) => void;
  /** Takes over an icon the app drew by itself (it becomes a placed icon); returns the new icon's ID. `meters` is the ground's height under it. */
  onAdoptIcon: (p: Placement, meters: number) => string;
}

const MAX_SCALE = 60;
/** After zooming or panning stops for this long, the map is drawn again at full quality. */
const SETTLE_MS = 110;

/** A seed for the little wander of a river routed from (x, y), so routing the same spot twice comes out the same. */
const mixRouteSeed = (x: number, y: number) => (Math.round(x * 1000) * 73856093) ^ (Math.round(y * 1000) * 19349663);

/** An icon placed by hand, as the map draws it. */
export function placedToPlacement(p: PlacedIcon): Placement {
  let variant = p.variant;
  if (variant === undefined) {
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
    variant = Math.abs(h);
  }
  return { x: p.x, y: p.y, size: p.size, set: p.kind, variant: variant % variantsOf(p.kind), angle: p.angle, shape: p.shape, placed: p.id };
}

/** The map on screen, in the atlas or painterly look. */
export function MapCanvas(props: Props) {
  const { handle, graph, seed, style, looks, placed, hiddenAuto, overlay, iconMode, iconTool, rivers, riverMode, riverTool, selectedRiver, selectedIcon, brush, tool, painter, onHover, onPick, onZoom } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  /** The view the canvas was last drawn at. Until the next full drawing, the canvas is moved and scaled to match the current view. */
  const [drawn, setDrawn] = useState<View | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverCell, setHoverCell] = useState(-1);
  const [space, setSpace] = useState(false);
  const drag = useRef<{ kind: 'pan' | 'paint' | 'icon' | 'river'; x: number; y: number; vx: number; vy: number; id?: string; ox?: number; oy?: number } | null>(null);
  /** While an icon is dragged: its new position (committed when the drag ends). */
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const noisy = useMemo(() => new NoisyEdges(graph, seed), [graph, seed]);
  const frame = useRef(0);
  const settle = useRef(0);
  /** True during a brush stroke: the map is drawn quickly until the stroke ends. */
  const painting = useRef(false);

  // What the drawing is built from, rebuilt only when its inputs change.
  const coast = useRef<Coast | null>(null);
  const coastStale = useRef(true);
  const heights = useRef<Int16Array | null>(null);
  const heightsStale = useRef(true);
  const icons = useRef<Placement[]>([]);
  const iconsStale = useRef(true);
  const shownIcons = useMemo(() => (moving ? placed.map((i) => (i.id === moving.id ? { ...i, x: moving.x, y: moving.y } : i)) : placed), [placed, moving]);
  const hidden = useMemo(() => new Set(hiddenAuto), [hiddenAuto]);
  const shapes = useMemo(() => riverShapes(rivers, graph.spacing), [rivers, graph]);
  /** A river being drawn by hand (map units), until the pointer is let go. */
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const live = useRef({ style, looks, placed: shownIcons, overlay, hidden, shapes });
  live.current = { style, looks, placed: shownIcons, overlay, hidden, shapes };

  const draw = useCallback(() => {
    const r = renderer.current;
    const map = getMap();
    if (!r || !map) return;
    const l = live.current;
    if (coastStale.current) {
      coast.current = buildCoast(map.graph, map.land, noisy);
      coastStale.current = false;
    }
    if (heightsStale.current || !heights.current) {
      heights.current = computeHeights(map.graph, map.land, map.elevation, l.placed);
      heightsStale.current = false;
    }
    if (iconsStale.current) {
      // A biome's plants stay off terrain icons placed by hand and off the rivers.
      const keepOff = underTerrain(map.graph, l.placed);
      const wet = underRivers(map.graph, l.shapes);
      for (let c = 0; c < keepOff.length; c++) keepOff[c] |= wet[c];
      const all: Placement[] = placeIcons(map.graph, map.land, map.biome, l.looks, seed, keepOff, l.hidden);
      // Waterfalls where rivers cross cliffs.
      for (const w of riverWaterfalls(l.shapes, l.placed, l.hidden)) {
        let h = 0;
        for (let i = 0; i < w.key.length; i++) h = (h * 31 + w.key.charCodeAt(i)) | 0;
        all.push({ x: w.x, y: w.y, size: w.size, set: 'waterfall', variant: Math.abs(h) % variantsOf('waterfall'), angle: w.angle, auto: w.key });
      }
      for (const p of l.placed) all.push(placedToPlacement(p));
      // Back to front by ground point (a waterfall's point is its lip, so it goes by its foot, in front of its cliff).
      const depth = (p: Placement) => (p.set === 'waterfall' ? p.y + p.size * 0.7 : p.y);
      all.sort((a, b) => depth(a) - depth(b));
      icons.current = all;
      iconsStale.current = false;
    }
    const v = viewRef.current;
    r.draw(
      v,
      { graph: map.graph, land: map.land, biome: map.biome, coast: coast.current, looks: l.looks, icons: icons.current, heights: heights.current, overlay: l.overlay, noisy, rivers: l.shapes },
      l.style,
      painting.current,
    );
    setDrawn(v);
  }, [noisy, seed]);

  /** Draws on the next animation frame (painting). */
  const drawSoon = useCallback(() => {
    window.clearTimeout(settle.current);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  /** Draws once zooming or panning has paused. */
  const drawSettled = useCallback(() => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(draw, SETTLE_MS);
  }, [draw]);

  useEffect(() => {
    try {
      renderer.current = new MapRenderer(canvas.current!);
    } catch (e) {
      setError((e as Error).message);
    }
    const off = onMapChange((change) => {
      if (change === 'land' || change === 'all') coastStale.current = true;
      if (change !== 'biome') heightsStale.current = true;
      iconsStale.current = true;
      if (change === 'all') painter.clearHistory();
      drawSoon();
    });
    return () => {
      off();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(settle.current);
      renderer.current = null;
    };
  }, [painter, drawSoon]);

  // A new graph or seed means new coastline wiggles and icon spots.
  useEffect(() => {
    coastStale.current = true;
    heightsStale.current = true;
    iconsStale.current = true;
    drawSoon();
  }, [noisy, drawSoon]);

  // Biome colors or icon sets changed.
  useEffect(() => {
    iconsStale.current = true;
    drawSoon();
  }, [looks, drawSoon]);

  // Icons placed by hand changed (or one is being dragged), or one of the app's own was taken over.
  useEffect(() => {
    heightsStale.current = true;
    iconsStale.current = true;
    drawSoon();
  }, [shownIcons, hidden, shapes, drawSoon]);

  // Icon drawings made in the background are ready: draw again.
  useEffect(() => {
    onSpritesReady(() => drawSoon());
    return () => onSpritesReady(null);
  }, [drawSoon]);

  useEffect(() => drawSoon(), [style, overlay, drawSoon]);
  useEffect(() => drawSettled(), [view, drawSettled]);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / graph.width, el.clientHeight / graph.height) * 0.94;
    const v = { scale, x: (el.clientWidth - graph.width * scale) / 2, y: (el.clientHeight - graph.height * scale) / 2 };
    viewRef.current = v;
    setView(v);
    drawSoon();
  }, [graph, drawSoon]);
  useImperativeHandle(handle, () => ({ fit }), [fit]);
  useEffect(fit, [fit]);
  useEffect(() => onZoom(view.scale), [view.scale, onZoom]);

  useEffect(() => {
    const ro = new ResizeObserver(() => drawSoon());
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, [drawSoon]);

  // The wheel zooms around the cursor (native listener, so Ctrl+wheel and pinch do not zoom the page).
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      setView((v) => {
        const min = Math.min(r.width / graph.width, r.height / graph.height) * 0.3;
        const scale = Math.max(min, Math.min(MAX_SCALE, v.scale * Math.exp(-e.deltaY * speed)));
        const k = scale / v.scale;
        return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [graph]);

  // Holding Space pans with the left button.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toMap = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  };

  const hoverAt = (clientX: number, clientY: number): Hover | null => {
    const map = getMap();
    if (!map) return null;
    const p = toMap(clientX, clientY);
    const cell = cellAt(map.graph, p.x, p.y);
    if (cell < 0) return null;
    const land = map.land[cell] === 1;
    return { ...p, cell, land, biomeSlot: map.biome[cell], elevation: land ? (heights.current?.[cell] ?? map.elevation[cell]) : 0 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (error) return;
    const pan = e.button === 1 || (e.button === 0 && (tool === 'hand' || space));
    if (pan) {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
      return;
    }
    if (e.button !== 0) return;
    // Working on the map lets go of any field in the side panel (which saves what was typed there), so keys like Delete reach the map.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const p = toMap(e.clientX, e.clientY);
    if (e.altKey) {
      const h = hoverAt(e.clientX, e.clientY);
      if (h) onPick(h);
      return;
    }
    if (riverMode) {
      const inside = p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height;
      if (riverTool === 'select') props.onSelectRiver(riverAt(shapes, p.x, p.y, 5 / viewRef.current.scale));
      else if (riverTool === 'route' && inside) {
        const map = getMap();
        const route = map && heights.current ? routeRiver(map.graph, map.land, heights.current, p.x, p.y, rivers, mixRouteSeed(p.x, p.y)) : null;
        if (route) props.onAddRiver(route);
      } else if (riverTool === 'draw' && inside) {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'river', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
        setDraft([[p.x, p.y]]);
      }
      return;
    }
    if (iconMode) {
      // The icon on top under the cursor: in Place, only icons placed by hand; in Select, any icon.
      let hit: Placement | null = null;
      if (iconTool === 'select') {
        // Only icons drawn at this zoom: too small to see is too small to pick.
        const scale = viewRef.current.scale;
        for (const q of icons.current) if (q.size * scale >= minPixels(q.set) && iconHit(q, p.x, p.y)) hit = q;
      } else for (const q of placed.map(placedToPlacement).sort((a, b) => a.y - b.y)) if (iconHit(q, p.x, p.y)) hit = q;
      if (hit) {
        let id = hit.placed;
        if (!id) {
          const map = getMap();
          const cell = map ? cellAt(map.graph, hit.x, hit.y - hit.size * 0.22) : -1;
          id = props.onAdoptIcon(hit, cell >= 0 ? (heights.current?.[cell] ?? 0) : 0);
        }
        props.onSelectIcon(id);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'icon', x: e.clientX, y: e.clientY, vx: 0, vy: 0, id, ox: hit.x - p.x, oy: hit.y - p.y };
      } else if (iconTool === 'select') props.onSelectIcon(null);
      else if (p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height) props.onPlaceIcon(p.x, p.y);
      return;
    }
    if (tool === 'fill') {
      painter.fill(brush, p.x, p.y);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: 'paint', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
    painting.current = true;
    painter.begin(brush, p.x, p.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    const h = hoverAt(e.clientX, e.clientY);
    setHoverCell(h ? h.cell : -1);
    onHover(h);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    else if (d.kind === 'river') {
      const p = toMap(e.clientX, e.clientY);
      setDraft((pts) => {
        if (!pts) return pts;
        const [lx, ly] = pts[pts.length - 1];
        return Math.hypot(p.x - lx, p.y - ly) < graph.spacing * 0.25 ? pts : [...pts, [Math.max(0, Math.min(graph.width, p.x)), Math.max(0, Math.min(graph.height, p.y))]];
      });
    }
    else if (d.kind === 'icon' && d.id) {
      const p = toMap(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) setMoving({ id: d.id, x: p.x + (d.ox ?? 0), y: p.y + (d.oy ?? 0) });
    } else {
      const p = toMap(e.clientX, e.clientY);
      painter.move(brush, p.x, p.y);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d?.kind === 'paint') {
      painter.end();
      // The stroke is done: draw the full look (shading, waves, soft blending) again.
      painting.current = false;
      drawSettled();
    } else if (d?.kind === 'icon' && moving) {
      props.onMoveIcon(moving.id, moving.x, moving.y);
      setMoving(null);
    } else if (d?.kind === 'river' && draft) {
      // A river drawn by hand: kept as drawn, with fewer points; it joins a river it ends on.
      let length = 0;
      for (let i = 1; i < draft.length; i++) length += Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]);
      if (length >= graph.spacing * 1.5) props.onAddRiver(snapToRivers(simplify(draft, graph.spacing * 0.12), rivers, graph.spacing * 0.6));
      setDraft(null);
    }
    drag.current = null;
  };

  // Until the next full drawing, move and scale the last drawing to match the current view.
  let transform: string | undefined;
  if (drawn && (drawn.x !== view.x || drawn.y !== view.y || drawn.scale !== view.scale)) {
    const k = view.scale / drawn.scale;
    transform = `translate(${view.x - k * drawn.x}px, ${view.y - k * drawn.y}px) scale(${k})`;
  }

  // The outline of the cell under the cursor: its wiggly edges, as the map draws them.
  const hoverShape = useMemo(() => (hoverCell < 0 ? null : cellOutline(graph, noisy, hoverCell)), [hoverCell, graph, noisy]);
  const hoverOutline = useMemo(() => {
    if (!hoverShape) return null;
    const pts: string[] = [];
    for (let i = 0; i < hoverShape.length; i += 2) pts.push(`${(view.x + hoverShape[i] * view.scale).toFixed(1)},${(view.y + hoverShape[i + 1] * view.scale).toFixed(1)}`);
    return pts.join(' ');
  }, [hoverShape, view]);

  const selected = selectedIcon ? shownIcons.find((i) => i.id === selectedIcon) : undefined;
  // A dashed line along the selected river.
  const selectedShape = (() => {
    const r = selectedRiver ? shapes.find((q) => q.id === selectedRiver) : undefined;
    return r ? r.pts.map(([x, y]) => `${(view.x + x * view.scale).toFixed(1)},${(view.y + y * view.scale).toFixed(1)}`).join(' ') : null;
  })();
  // A dashed box around the selected icon's drawing.
  const selectedBox = (() => {
    if (!selected) return null;
    const q = placedToPlacement(selected);
    const b = iconBox(q, placementLook(q));
    const sx = view.x + q.x * view.scale;
    const sy = view.y + q.y * view.scale;
    return { left: sx + b.left * view.scale, top: sy + b.top * view.scale, width: b.width * view.scale, height: b.height * view.scale };
  })();
  const panning = tool === 'hand' || space;
  const showBrush = cursor && !panning && !iconMode && !riverMode && tool === 'brush' && !error;

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{
        cursor: panning ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : riverMode ? (riverTool === 'select' ? 'default' : 'crosshair') : iconMode ? (drag.current?.kind === 'icon' ? 'grabbing' : iconTool === 'select' ? 'default' : 'copy') : tool === 'fill' ? 'cell' : showBrush ? 'none' : 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        setHoverCell(-1);
        onHover(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full origin-top-left" style={{ transform }} />
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {hoverOutline && <polygon points={hoverOutline} fill="none" stroke="#fc3f3f" strokeWidth={1.6} strokeLinejoin="round" data-testid="hover-cell" />}
        {draft && draft.length > 1 && (
          <polyline points={draft.map(([x, y]) => `${(view.x + x * view.scale).toFixed(1)},${(view.y + y * view.scale).toFixed(1)}`).join(' ')} fill="none" stroke="#002657" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-testid="river-draft" />
        )}
        {selectedShape && (
          <polyline points={selectedShape} fill="none" stroke="#002657" strokeWidth={1.5} strokeDasharray="5 4" strokeLinecap="round" data-testid="selected-river" />
        )}
        {selectedBox && (
          <rect
            x={selectedBox.left}
            y={selectedBox.top}
            width={selectedBox.width}
            height={selectedBox.height}
            fill="none"
            stroke="#002657"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            data-testid="selected-icon"
          />
        )}
      </svg>
      {showBrush && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-accent shadow-[0_0_0_1px_rgba(250,238,218,0.9)]"
          style={{
            left: cursor.x - brush.radius * view.scale,
            top: cursor.y - brush.radius * view.scale,
            width: Math.max(4, brush.radius * 2 * view.scale),
            height: Math.max(4, brush.radius * 2 * view.scale),
          }}
        />
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="flex max-w-md items-start gap-2 rounded-xl border border-warn/35 bg-surface p-4 text-sm text-warn shadow-pop">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

