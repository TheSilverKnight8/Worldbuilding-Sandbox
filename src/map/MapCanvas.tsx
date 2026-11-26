import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getMap, onMapChange } from '../lib/store';
import type { SlotLook } from '../lib/map/biomes';
import { cellOutline } from '../lib/map/cells';
import { buildCoast, type Coast } from '../lib/map/coast';
import { cellAt, type Graph } from '../lib/map/graph';
import { ROTATABLE, placeIcons, type Placement } from '../lib/map/icons';
import { NoisyEdges } from '../lib/map/noisy';
import type { Brush, MapPainter } from '../lib/map/paint';
import { MapRenderer, type MapStyle, type View } from '../lib/map/render';
import { autoTerrain, computeHeights, isCut } from '../lib/map/terrain';
import type { PlacedIcon } from '../lib/world/types';

export type Tool = 'brush' | 'fill' | 'hand';

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
  overlay: boolean;
  /** Icons mode: clicks place and select icons instead of painting. */
  iconMode: boolean;
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
}

const MAX_SCALE = 60;
/** After zooming or panning stops for this long, the map is drawn again at full quality. */
const SETTLE_MS = 110;

/** Which placed icon is under a map point (the one drawn on top), or null. */
function iconAt(icons: PlacedIcon[], x: number, y: number) {
  let best: PlacedIcon | null = null;
  for (const i of icons) {
    const hit = ROTATABLE.has(i.kind) ? Math.hypot(x - i.x, y - i.y) <= i.size * 0.55 : Math.abs(x - i.x) <= i.size * 0.5 && y <= i.y + i.size * 0.1 && y >= i.y - i.size;
    if (hit && (!best || i.y >= best.y)) best = i;
  }
  return best;
}

/** The map on screen, in the atlas or painterly look. */
export function MapCanvas(props: Props) {
  const { handle, graph, seed, style, looks, placed, overlay, iconMode, selectedIcon, brush, tool, painter, onHover, onPick, onZoom } = props;
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
  const drag = useRef<{ kind: 'pan' | 'paint' | 'icon'; x: number; y: number; vx: number; vy: number; id?: string; ox?: number; oy?: number } | null>(null);
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
  const live = useRef({ style, looks, placed: shownIcons, overlay });
  live.current = { style, looks, placed: shownIcons, overlay };

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
      const auto = autoTerrain(map.graph, map.land, heights.current, l.placed, seed);
      const all: Placement[] = placeIcons(map.graph, map.land, map.biome, l.looks, seed, auto.noPlants);
      for (const a of auto.icons) all.push({ x: a.x, y: a.y, size: a.size, set: a.kind, variant: a.variant });
      for (const p of l.placed) all.push({ x: p.x, y: p.y, size: p.size, set: p.kind, variant: Math.abs(p.id.charCodeAt(0)) % 3, angle: p.angle, placed: p.id });
      // Front to back by ground point; passes, valleys, canyons and cliffs placed by hand go over everything, as marks cut into the land.
      const over = (p: Placement) => (p.placed && isCut(p.set) ? 1 : 0);
      all.sort((a, b) => over(a) - over(b) || a.y - b.y);
      icons.current = all;
      iconsStale.current = false;
    }
    const v = viewRef.current;
    r.draw(
      v,
      { graph: map.graph, land: map.land, biome: map.biome, coast: coast.current, looks: l.looks, icons: icons.current, heights: heights.current, overlay: l.overlay, noisy },
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

  // Icons placed by hand changed (or one is being dragged).
  useEffect(() => {
    heightsStale.current = true;
    iconsStale.current = true;
    drawSoon();
  }, [shownIcons, drawSoon]);

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
    if (iconMode) {
      const hit = iconAt(placed, p.x, p.y);
      if (hit) {
        props.onSelectIcon(hit.id);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'icon', x: e.clientX, y: e.clientY, vx: 0, vy: 0, id: hit.id, ox: hit.x - p.x, oy: hit.y - p.y };
      } else if (p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height) props.onPlaceIcon(p.x, p.y);
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
  const panning = tool === 'hand' || space;
  const showBrush = cursor && !panning && !iconMode && tool === 'brush' && !error;

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{
        cursor: panning ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : iconMode ? (drag.current?.kind === 'icon' ? 'grabbing' : 'copy') : tool === 'fill' ? 'cell' : showBrush ? 'none' : 'crosshair',
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
        {selected &&
          (ROTATABLE.has(selected.kind) ? (
            <circle cx={view.x + selected.x * view.scale} cy={view.y + selected.y * view.scale} r={selected.size * 0.55 * view.scale} fill="none" stroke="#002657" strokeWidth={1.5} strokeDasharray="5 4" />
          ) : (
            <rect
              x={view.x + (selected.x - selected.size * 0.5) * view.scale}
              y={view.y + (selected.y - selected.size) * view.scale}
              width={selected.size * view.scale}
              height={selected.size * 1.1 * view.scale}
              fill="none"
              stroke="#002657"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          ))}
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

