import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getMap, onMapChange } from '../lib/store';
import type { SlotLook } from '../lib/map/biomes';
import { cellOutline } from '../lib/map/cells';
import { buildCoast, type Coast } from '../lib/map/coast';
import { cellAt, type Graph } from '../lib/map/graph';
import { iconBox, iconHit, minPixels, onSpritesReady, placementLook, type Placement } from '../lib/map/icons';
import { NoisyEdges } from '../lib/map/noisy';
import { borderLine } from '../lib/map/borders';
import { cliffAt, cliffDrawings, cliffWaterfalls, riversAtFalls, snapCliff, type AutoWaterfall, type CliffDrawing } from '../lib/map/cliffs';
import { riverAt, riverShapes, routeRiver, snapLine, type RiverShape } from '../lib/map/rivers';
import { mapIcons, placedToPlacement } from '../lib/map/scene';
import type { Brush, MapPainter } from '../lib/map/paint';
import { MapRenderer, type MapStyle, type View } from '../lib/map/render';
import { computeHeights } from '../lib/map/terrain';
import { loadMapFonts, measureContext, textAt, textOutline } from '../lib/map/text';
import type { NodeTarget } from '../lib/map/nodes';
import type { Cliff, MapText, PlacedIcon, River } from '../lib/world/types';

export type Tool = 'brush' | 'fill' | 'hand';
/** In Icons mode: place new icons, or select any icon (the app's own ones included). */
export type IconTool = 'place' | 'select';
/** In Rivers mode: draw a river by hand, click a source to route one downhill, or select one. */
export type RiverTool = 'draw' | 'route' | 'select';
/** In Cliffs mode: draw a cliff along borders, or select one. */
export type CliffTool = 'draw' | 'select';
/** In Text mode: add text (a click: straight; a drag: along the line dragged), or select and move it. */
export type TextTool = 'add' | 'select';

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
  /** Centers the map on (x, y), zoomed in to show the land around it. */
  focus: (x: number, y: number) => void;
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
  /** A new river: its chain of polygon corners, from source to mouth. */
  onAddRiver: (vertices: number[]) => void;
  onSelectRiver: (id: string | null) => void;
  cliffs: Cliff[];
  /** Cliffs mode: clicks draw and select cliffs instead of painting. */
  cliffMode: boolean;
  cliffTool: CliffTool;
  selectedCliff: string | null;
  /** A new cliff: its chain of polygon corners, the drop on its right. */
  onAddCliff: (vertices: number[]) => void;
  onSelectCliff: (id: string | null) => void;
  texts: MapText[];
  /** Text mode: clicks add, select and move text instead of painting. */
  textMode: boolean;
  textTool: TextTool;
  selectedText: string | null;
  /** New text at (x, y), straight, or along `curve` (map units from (x, y)). */
  onAddText: (x: number, y: number, curve?: [number, number][]) => void;
  onSelectText: (id: string | null) => void;
  onMoveText: (id: string, x: number, y: number) => void;
  /** Nodes mode: clicks pick an icon or text to link to an entry. */
  nodeMode: boolean;
  selectedNode: NodeTarget | null;
  onPickNode: (t: NodeTarget | null) => void;
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

export { placedToPlacement };

/** The map on screen, in the atlas or painterly look. */
export function MapCanvas(props: Props) {
  const { handle, graph, seed, style, looks, placed, hiddenAuto, overlay, iconMode, iconTool, rivers, riverMode, riverTool, selectedRiver, cliffs, cliffMode, cliffTool, selectedCliff, texts, textMode, textTool, selectedText, nodeMode, selectedNode, selectedIcon, brush, tool, painter, onHover, onPick, onZoom } = props;
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
  const drag = useRef<{ kind: 'pan' | 'paint' | 'icon' | 'river' | 'cliff' | 'text' | 'move-text'; x: number; y: number; vx: number; vy: number; id?: string; ox?: number; oy?: number } | null>(null);
  /** While an icon is dragged: its new position (committed when the drag ends). */
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Nodes mode: the icon or text under the cursor. */
  const [hoverItem, setHoverItem] = useState<{ kind: 'icon' | 'text'; id: string; hit: Placement | null } | null>(null);
  useEffect(() => {
    if (!nodeMode) setHoverItem(null);
  }, [nodeMode]);
  /** While a text is dragged: its new position. */
  const [movingText, setMovingText] = useState<{ id: string; x: number; y: number } | null>(null);
  const shownTexts = useMemo(() => (movingText ? texts.map((t) => (t.id === movingText.id ? { ...t, x: movingText.x, y: movingText.y } : t)) : texts), [texts, movingText]);
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
  const shapes = useMemo(() => riverShapes(rivers, graph, noisy), [rivers, graph, noisy]);
  /** A river or cliff being drawn by hand (map units), until the pointer is let go. */
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const live = useRef({ style, looks, placed: shownIcons, overlay, hidden, shapes, cliffs, texts: shownTexts });
  live.current = { style, looks, placed: shownIcons, overlay, hidden, shapes, cliffs, texts: shownTexts };

  /** The waterfalls where rivers go over cliffs, the rivers as drawn (widening up to them) and the cliffs as drawn: made again when the rivers, cliffs or land change. */
  const derived = useRef<{ shapes: RiverShape[]; cliffs: Cliff[]; hidden: Set<string>; land: number; falls: AutoWaterfall[]; rivers: RiverShape[]; art: CliffDrawing[] } | null>(null);
  const landTick = useRef(0);
  const derive = useCallback(() => {
    const map = getMap();
    const l = live.current;
    const d = derived.current;
    if (d && d.shapes === l.shapes && d.cliffs === l.cliffs && d.hidden === l.hidden && d.land === landTick.current) return d;
    const falls = map ? cliffWaterfalls(map.graph, noisy, map.land, l.shapes, l.cliffs, l.hidden) : [];
    const next = { shapes: l.shapes, cliffs: l.cliffs, hidden: l.hidden, land: landTick.current, falls, rivers: riversAtFalls(l.shapes, falls, graph.spacing), art: cliffDrawings(l.cliffs, graph, noisy, falls) };
    derived.current = next;
    return next;
  }, [graph, noisy]);

  /** What the icon list was last made from. */
  const builtFrom = useRef<{ placed: PlacedIcon[]; hidden: Set<string>; shapes: RiverShape[]; cliffs: Cliff[] } | null>(null);
  /** The icons as the map draws them, back to front: made again when anything they depend on has changed. */
  const buildIcons = useCallback(() => {
    const map = getMap();
    const l = live.current;
    const b = builtFrom.current;
    if (!map || (!iconsStale.current && b && b.placed === l.placed && b.hidden === l.hidden && b.shapes === l.shapes && b.cliffs === l.cliffs)) return icons.current;
    const all = mapIcons(map.graph, map.land, map.biome, l.looks, seed, l.placed, l.hidden, l.shapes, l.cliffs, derive().falls);
    icons.current = all;
    iconsStale.current = false;
    builtFrom.current = { placed: l.placed, hidden: l.hidden, shapes: l.shapes, cliffs: l.cliffs };
    return all;
  }, [seed, derive]);

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
      heights.current = computeHeights(map.graph, map.land, map.elevation, l.placed, l.cliffs);
      heightsStale.current = false;
    }
    const v = viewRef.current;
    r.draw(
      v,
      { graph: map.graph, land: map.land, biome: map.biome, coast: coast.current, looks: l.looks, icons: buildIcons(), heights: heights.current, overlay: l.overlay, noisy, rivers: derive().rivers, cliffs: derive().art, texts: l.texts },
      l.style,
      painting.current,
    );
    setDrawn(v);
  }, [noisy, buildIcons, derive]);

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
      if (change === 'land' || change === 'all') {
        coastStale.current = true;
        landTick.current++;
      }
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
  }, [shownIcons, hidden, shapes, cliffs, drawSoon]);

  // Icon drawings made in the background are ready: draw again.
  useEffect(() => {
    onSpritesReady(() => drawSoon());
    return () => onSpritesReady(null);
  }, [drawSoon]);

  useEffect(() => drawSoon(), [style, overlay, shownTexts, drawSoon]);
  // The map's fonts: draw again once they are in.
  useEffect(() => {
    let live = true;
    loadMapFonts().then(() => live && drawSoon());
    return () => {
      live = false;
    };
  }, [drawSoon]);
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
  const focus = useCallback(
    (x: number, y: number) => {
      const el = box.current;
      if (!el) return;
      // About forty polygons across, or closer if already closer.
      const scale = Math.max(viewRef.current.scale, el.clientWidth / (graph.spacing * 40));
      const v = { scale, x: el.clientWidth / 2 - x * scale, y: el.clientHeight / 2 - y * scale };
      viewRef.current = v;
      setView(v);
      drawSoon();
    },
    [graph, drawSoon],
  );
  useImperativeHandle(handle, () => ({ fit, focus }), [fit, focus]);
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
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    const down = (e: KeyboardEvent) => {
      // Not while the map is hidden (the Entries view is shown), nor while typing anywhere.
      if (e.code === 'Space' && !typing(e) && box.current?.offsetParent) {
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

  /** The icon or text on top at map point (x, y), as drawn at this zoom (text is drawn over icons). */
  const itemAt = (x: number, y: number): { kind: 'icon' | 'text'; id: string; placed: boolean; hit: Placement | null } | null => {
    const t = textAt(measureContext(), live.current.texts, x, y, graph.spacing);
    if (t) return { kind: 'text', id: t, placed: true, hit: null };
    let hit: Placement | null = null;
    const scale = viewRef.current.scale;
    for (const q of buildIcons()) if (q.size * scale >= minPixels(q.set) && iconHit(q, x, y)) hit = q;
    if (!hit) return null;
    return { kind: 'icon', id: hit.placed ?? hit.auto ?? '', placed: !!hit.placed, hit };
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
        const route = map && heights.current ? routeRiver(map.graph, map.land, heights.current, p.x, p.y, rivers, cliffs) : null;
        if (route) props.onAddRiver(route);
      } else if (riverTool === 'draw' && inside) {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'river', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
        setDraft([[p.x, p.y]]);
      }
      return;
    }
    if (nodeMode) {
      const t = itemAt(p.x, p.y);
      if (t && t.kind === 'icon' && !t.placed && t.hit) {
        // One of the app's own icons (a biome's plants, a waterfall) is taken over first, as with Select.
        const map = getMap();
        const cell = map ? cellAt(map.graph, t.hit.x, t.hit.y - t.hit.size * 0.22) : -1;
        props.onPickNode({ kind: 'icon', id: props.onAdoptIcon(t.hit, cell >= 0 ? (heights.current?.[cell] ?? 0) : 0) });
      } else props.onPickNode(t ? { kind: t.kind, id: t.id } : null);
      return;
    }
    if (textMode) {
      const inside = p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height;
      if (textTool === 'add') {
        if (!inside) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'text', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
        setDraft([[p.x, p.y]]);
        return;
      }
      const id = textAt(measureContext(), texts, p.x, p.y, graph.spacing);
      props.onSelectText(id);
      if (id) {
        const t = texts.find((q) => q.id === id)!;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'move-text', x: e.clientX, y: e.clientY, vx: 0, vy: 0, id, ox: t.x - p.x, oy: t.y - p.y };
      }
      return;
    }
    if (cliffMode) {
      const inside = p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height;
      if (cliffTool === 'select') props.onSelectCliff(cliffAt(graph, cliffs, p.x, p.y, 6 / viewRef.current.scale));
      else if (inside) {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { kind: 'cliff', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
        setDraft([[p.x, p.y]]);
      }
      return;
    }
    if (iconMode) {
      // Place: always places, on the polygon clicked (the editor rerolls or replaces an icon already
      // standing on it). Select: the icon on top under the cursor, any icon.
      if (iconTool === 'place') {
        if (p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height) props.onPlaceIcon(p.x, p.y);
        return;
      }
      let hit: Placement | null = null;
      // Only icons drawn at this zoom: too small to see is too small to pick.
      const scale = viewRef.current.scale;
      // As the map shows them now, even if a change (an undo, say) has not been drawn yet.
      for (const q of buildIcons()) if (q.size * scale >= minPixels(q.set) && iconHit(q, p.x, p.y)) hit = q;
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
      } else props.onSelectIcon(null);
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
    if (nodeMode && !drag.current) {
      const p = toMap(e.clientX, e.clientY);
      const t = itemAt(p.x, p.y);
      setHoverItem(t ? { kind: t.kind, id: t.id, hit: t.hit } : null);
    }
    const h = hoverAt(e.clientX, e.clientY);
    setHoverCell(h ? h.cell : -1);
    onHover(h);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    else if (d.kind === 'move-text' && d.id) {
      const p = toMap(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) setMovingText({ id: d.id, x: p.x + (d.ox ?? 0), y: p.y + (d.oy ?? 0) });
    } else if (d.kind === 'river' || d.kind === 'cliff' || d.kind === 'text') {
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
      // A river drawn by hand: moved onto the borders nearest the stroke; it joins a river it meets or ends near.
      let length = 0;
      for (let i = 1; i < draft.length; i++) length += Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]);
      const map = getMap();
      const path = map && length >= graph.spacing * 1.5 ? snapLine(map.graph, map.land, draft, rivers, graph.spacing * 0.6, cliffs) : null;
      if (path) props.onAddRiver(path);
      setDraft(null);
    } else if (d?.kind === 'move-text' && movingText) {
      props.onMoveText(movingText.id, movingText.x, movingText.y);
      setMovingText(null);
    } else if (d?.kind === 'text' && draft) {
      // A click adds straight text; a drag adds text along the line dragged (smoothed, its middle at the middle of the line).
      let length = 0;
      for (let i = 1; i < draft.length; i++) length += Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]);
      if (length < graph.spacing * 1.5) props.onAddText(draft[0][0], draft[0][1]);
      else {
        const run = [0];
        for (let i = 1; i < draft.length; i++) run.push(run[i - 1] + Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]));
        const at = (s: number): [number, number] => {
          let i = 1;
          while (i < draft.length - 1 && run[i] < s) i++;
          const t = (s - run[i - 1]) / (run[i] - run[i - 1] || 1);
          return [draft[i - 1][0] + (draft[i][0] - draft[i - 1][0]) * t, draft[i - 1][1] + (draft[i][1] - draft[i - 1][1]) * t];
        };
        const n = 24;
        let pts = Array.from({ length: n + 1 }, (_, k) => at((length * k) / n));
        for (let pass = 0; pass < 3; pass++) pts = pts.map((q, k) => (k === 0 || k === n ? q : [(pts[k - 1][0] + 2 * q[0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * q[1] + pts[k + 1][1]) / 4]));
        const [mx, my] = at(length / 2);
        props.onAddText(mx, my, pts.map(([x, y]) => [x - mx, y - my]));
      }
      setDraft(null);
    } else if (d?.kind === 'cliff' && draft) {
      // A cliff drawn by hand: moved onto the borders nearest the stroke, the drop on its right.
      let length = 0;
      for (let i = 1; i < draft.length; i++) length += Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]);
      const map = getMap();
      const path = map && length >= graph.spacing * 1.5 ? snapCliff(map.graph, map.land, draft) : null;
      if (path) props.onAddCliff(path);
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
  // The selected cliff: a dashed line along its rim, with short marks on the drop side.
  const toScreen = ([x, y]: [number, number]) => `${(view.x + x * view.scale).toFixed(1)},${(view.y + y * view.scale).toFixed(1)}`;
  const dropTicks = (pts: [number, number][], every: number) => {
    let d = '';
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      run += len;
      if (run < every || len === 0) continue;
      run = 0;
      const mx = view.x + ((ax + bx) / 2) * view.scale;
      const my = view.y + ((ay + by) / 2) * view.scale;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      d += `M${mx.toFixed(1)},${my.toFixed(1)}L${(mx + nx * 7).toFixed(1)},${(my + ny * 7).toFixed(1)}`;
    }
    return d;
  };
  const selectedCliffLine = (() => {
    const c = selectedCliff ? cliffs.find((q) => q.id === selectedCliff) : undefined;
    if (!c || c.vertices.length < 2) return null;
    const { pts } = borderLine(graph, noisy, c.vertices);
    return { line: pts.map(toScreen).join(' '), ticks: dropTicks(pts, 14 / view.scale) };
  })();
  const draftTicks = draft && drag.current?.kind === 'cliff' && draft.length > 1 ? dropTicks(draft, 14 / view.scale) : null;
  // A dashed box around the selected icon's drawing.
  const selectedBox = (() => {
    if (!selected) return null;
    const q = placedToPlacement(selected);
    const b = iconBox(q, placementLook(q));
    const sx = view.x + q.x * view.scale;
    const sy = view.y + q.y * view.scale;
    return { left: sx + b.left * view.scale, top: sy + b.top * view.scale, width: b.width * view.scale, height: b.height * view.scale };
  })();
  // Nodes mode: an outline around the icon or text under the cursor and the one picked, and a mark on each node.
  const outlineOf = (t: { kind: 'icon' | 'text'; id: string; hit?: Placement | null } | null): string | null => {
    if (!t) return null;
    if (t.kind === 'text') {
      const x = shownTexts.find((q) => q.id === t.id);
      return x ? textOutline(measureContext(), x, graph.spacing).map(toScreen).join(' ') : null;
    }
    const placedIcon = shownIcons.find((i) => i.id === t.id);
    const q = placedIcon ? placedToPlacement(placedIcon) : t.hit;
    if (!q) return null;
    const b = iconBox(q, placementLook(q));
    const corners: [number, number][] = [[q.x + b.left, q.y + b.top], [q.x + b.left + b.width, q.y + b.top], [q.x + b.left + b.width, q.y + b.top + b.height], [q.x + b.left, q.y + b.top + b.height]];
    return corners.map(toScreen).join(' ');
  };
  const hoverNodeLine = nodeMode ? outlineOf(hoverItem) : null;
  const pickedNodeLine = nodeMode ? outlineOf(selectedNode) : null;
  // Node marks: at an icon's foot; under a text's middle, clear of its letters.
  const underText = (t: MapText): [number, number] => {
    const o = textOutline(measureContext(), t, graph.spacing);
    if (t.curve && o.length === 26) return o[19];
    return [(o[2][0] + o[3][0]) / 2, (o[2][1] + o[3][1]) / 2];
  };
  const nodeMarks = nodeMode
    ? [...shownIcons.filter((i) => i.entry).map((i) => [i.x, i.y] as [number, number]), ...shownTexts.filter((t) => t.entry).map(underText)].map(([x, y]) => ({ x: view.x + x * view.scale, y: view.y + y * view.scale }))
    : [];
  const panning = tool === 'hand' || space;
  const showBrush = cursor && !panning && !iconMode && !riverMode && !cliffMode && !textMode && !nodeMode && tool === 'brush' && !error;
  // The selected text: a dashed line around it.
  const selectedTextLine = (() => {
    const t = selectedText ? shownTexts.find((q) => q.id === selectedText) : undefined;
    return t ? textOutline(measureContext(), t, graph.spacing).map(toScreen).join(' ') : null;
  })();

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      style={{
        cursor: panning ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : riverMode ? (riverTool === 'select' ? 'default' : 'crosshair') : cliffMode ? (cliffTool === 'select' ? 'default' : 'crosshair') : textMode ? (textTool === 'select' ? (drag.current?.kind === 'move-text' ? 'grabbing' : 'default') : 'text') : nodeMode ? (hoverItem ? 'pointer' : 'default') : iconMode ? (drag.current?.kind === 'icon' ? 'grabbing' : iconTool === 'select' ? 'default' : 'copy') : tool === 'fill' ? 'cell' : showBrush ? 'none' : 'crosshair',
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
        {draftTicks && <path d={draftTicks} fill="none" stroke="#002657" strokeWidth={2} strokeLinecap="round" data-testid="cliff-draft-drop" />}
        {hoverNodeLine && <polygon points={hoverNodeLine} fill="none" stroke="#fc3f3f" strokeWidth={1.5} strokeDasharray="4 3" data-testid="hover-node" />}
        {pickedNodeLine && <polygon points={pickedNodeLine} fill="none" stroke="#002657" strokeWidth={1.8} strokeDasharray="5 4" data-testid="picked-node" />}
        {nodeMarks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={5} fill="#002657" stroke="#fffaf0" strokeWidth={2} data-testid="node-mark" />
        ))}
        {selectedTextLine && <polygon points={selectedTextLine} fill="none" stroke="#002657" strokeWidth={1.5} strokeDasharray="5 4" data-testid="selected-text" />}
        {selectedCliffLine && (
          <>
            <polyline points={selectedCliffLine.line} fill="none" stroke="#002657" strokeWidth={1.5} strokeDasharray="5 4" strokeLinecap="round" data-testid="selected-cliff" />
            <path d={selectedCliffLine.ticks} fill="none" stroke="#002657" strokeWidth={1.5} strokeLinecap="round" />
          </>
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

