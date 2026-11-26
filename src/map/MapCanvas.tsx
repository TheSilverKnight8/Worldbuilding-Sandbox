import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getMap, onMapChange } from '../lib/store';
import type { SlotLook } from '../lib/map/biomes';
import { buildCoast, type Coast } from '../lib/map/coast';
import { cellAt, type Graph } from '../lib/map/graph';
import { placeIcons, type Placement } from '../lib/map/icons';
import { NoisyEdges } from '../lib/map/noisy';
import type { Brush, MapPainter } from '../lib/map/paint';
import { MapRenderer, type MapStyle, type View } from '../lib/map/render';

export type Tool = 'brush' | 'fill' | 'hand';

/** What is under the cursor: map position (map units) and the cell. */
export interface Hover {
  x: number;
  y: number;
  cell: number;
  land: boolean;
  /** Biome slot (0 = none). */
  biomeSlot: number;
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
  brush: Brush;
  tool: Tool;
  painter: MapPainter;
  onHover: (h: Hover | null) => void;
  onPick: (h: Hover) => void;
  onZoom: (scale: number) => void;
}

const MAX_SCALE = 60;
/** After zooming or panning stops for this long, the map is drawn again at full quality. */
const SETTLE_MS = 110;

/** The map on screen, in the atlas or painterly look. */
export function MapCanvas({ handle, graph, seed, style, looks, brush, tool, painter, onHover, onPick, onZoom }: Props) {
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
  const [space, setSpace] = useState(false);
  const drag = useRef<{ kind: 'pan' | 'paint'; x: number; y: number; vx: number; vy: number } | null>(null);
  const noisy = useMemo(() => new NoisyEdges(graph, seed), [graph, seed]);
  const frame = useRef(0);
  const settle = useRef(0);
  /** True during a brush stroke: the map is drawn quickly until the stroke ends. */
  const painting = useRef(false);

  // What the drawing is built from, rebuilt only when its inputs change.
  const coast = useRef<Coast | null>(null);
  const coastStale = useRef(true);
  const icons = useRef<Placement[]>([]);
  const iconsStale = useRef(true);
  const live = useRef({ style, looks });
  live.current = { style, looks };

  const draw = useCallback(() => {
    const r = renderer.current;
    const map = getMap();
    if (!r || !map) return;
    if (coastStale.current) {
      coast.current = buildCoast(map.graph, map.land, noisy);
      coastStale.current = false;
    }
    if (iconsStale.current) {
      icons.current = placeIcons(map.graph, map.land, map.biome, live.current.looks, seed);
      iconsStale.current = false;
    }
    const v = viewRef.current;
    r.draw(
      v,
      { graph: map.graph, land: map.land, biome: map.biome, coast: coast.current, looks: live.current.looks, icons: icons.current },
      live.current.style,
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
      if (change !== 'biome') coastStale.current = true;
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
    iconsStale.current = true;
    drawSoon();
  }, [noisy, drawSoon]);

  // Biome colors or icon sets changed.
  useEffect(() => {
    iconsStale.current = true;
    drawSoon();
  }, [looks, drawSoon]);

  useEffect(() => drawSoon(), [style, drawSoon]);
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
    return cell < 0 ? null : { ...p, cell, land: map.land[cell] === 1, biomeSlot: map.biome[cell] };
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
    const p = toMap(e.clientX, e.clientY);
    if (e.altKey) {
      const h = hoverAt(e.clientX, e.clientY);
      if (h) onPick(h);
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
    onHover(hoverAt(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    else {
      const p = toMap(e.clientX, e.clientY);
      painter.move(brush, p.x, p.y);
    }
  };

  const onPointerUp = () => {
    if (drag.current?.kind === 'paint') {
      painter.end();
      // The stroke is done: draw the full look (shading, waves, soft blending) again.
      painting.current = false;
      drawSettled();
    }
    drag.current = null;
  };

  // Until the next full drawing, move and scale the last drawing to match the current view.
  let transform: string | undefined;
  if (drawn && (drawn.x !== view.x || drawn.y !== view.y || drawn.scale !== view.scale)) {
    const k = view.scale / drawn.scale;
    transform = `translate(${view.x - k * drawn.x}px, ${view.y - k * drawn.y}px) scale(${k})`;
  }

  const panning = tool === 'hand' || space;
  const showBrush = cursor && !panning && tool === 'brush' && !error;

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{ cursor: panning ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'fill' ? 'cell' : showBrush ? 'none' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        onHover(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full origin-top-left" style={{ transform }} />
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
