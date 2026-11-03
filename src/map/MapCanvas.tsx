import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { AlertTriangle } from 'lucide-react';
import { backdropBlob, getLayers, onLayersChange } from '../lib/store';
import { MapRenderer, type View } from '../lib/map/renderer';
import { cellAt, type Brush, type Painter } from '../lib/map/paint';
import type { Backdrop } from '../lib/world/types';

export type Tool = 'brush' | 'fill' | 'hand';

export interface LayerSettings {
  backdrop: boolean;
  backdropOpacity: number;
  map: boolean;
  mapOpacity: number;
  biomes: boolean;
  relief: boolean;
}

export type Hover = ReturnType<typeof cellAt>;

export interface MapCanvasHandle {
  fit: () => void;
}

interface Props {
  handle: Ref<MapCanvasHandle>;
  width: number;
  height: number;
  backdrop: Backdrop | null;
  palette: Uint8Array;
  brush: Brush;
  tool: Tool;
  layers: LayerSettings;
  painter: Painter;
  onHover: (h: Hover) => void;
  onPick: (h: NonNullable<Hover>) => void;
  onZoom: (scale: number) => void;
}

const MAX_SCALE = 48;

/** The map on screen: the backdrop image underneath, the app's drawing of the map on top. */
export function MapCanvas({ handle, width, height, backdrop, palette, brush, tool, layers, painter, onHover, onPick, onZoom }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const drag = useRef<{ kind: 'pan' | 'paint'; x: number; y: number; vx: number; vy: number } | null>(null);
  const frame = useRef(0);

  // Draw on the next animation frame, once, however many changes come in before it.
  const settings = useRef({ layers, palette });
  settings.current = { layers, palette };
  const invalidate = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const r = renderer.current;
      if (!r || r.lost) return;
      const l = settings.current.layers;
      r.draw(viewRef.current, { biomes: l.biomes, relief: l.relief, opacity: l.map ? l.mapOpacity : 0 });
    });
  }, []);

  // Set up the renderer and follow changes to the grids.
  useEffect(() => {
    const c = canvas.current!;
    try {
      renderer.current = new MapRenderer(c);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const layers = getLayers();
    if (layers) renderer.current.setLayers(layers);
    const off = onLayersChange((rect) => {
      const r = renderer.current;
      if (!r) return;
      if (rect) r.update(rect);
      else {
        const l = getLayers();
        if (l) r.setLayers(l);
        painter.clearHistory();
      }
      invalidate();
    });
    const lost = (e: Event) => e.preventDefault();
    const restored = () => {
      renderer.current?.init();
      invalidate();
    };
    c.addEventListener('webglcontextlost', lost);
    c.addEventListener('webglcontextrestored', restored);
    return () => {
      off();
      c.removeEventListener('webglcontextlost', lost);
      c.removeEventListener('webglcontextrestored', restored);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      renderer.current = null;
    };
  }, [invalidate, painter]);

  useEffect(() => {
    renderer.current?.setPalette(palette);
    invalidate();
  }, [palette, invalidate]);

  useEffect(invalidate, [view, layers, invalidate]);

  // Fit the whole map in the window.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / width, el.clientHeight / height) * 0.94;
    setView({ scale, x: (el.clientWidth - width * scale) / 2, y: (el.clientHeight - height * scale) / 2 });
  }, [width, height]);
  useImperativeHandle(handle, () => ({ fit }), [fit]);
  useEffect(fit, [fit]);
  useEffect(() => onZoom(view.scale), [view.scale, onZoom]);

  // Redraw when the window changes size.
  useEffect(() => {
    const ro = new ResizeObserver(invalidate);
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, [invalidate]);

  // The backdrop image, read from storage.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setBackdropUrl(null);
    if (!backdrop) return;
    void backdropBlob().then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setBackdropUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [backdrop]);

  // Holding Space pans with the left button.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
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

  const toCell = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  };

  const hoverAt = (clientX: number, clientY: number) => {
    const l = getLayers();
    const c = toCell(clientX, clientY);
    onHover(l ? cellAt(l, c.x, c.y) : null);
  };

  // The wheel zooms around the cursor. A native listener, so it can stop Chrome from
  // zooming the whole page on Ctrl+wheel or a trackpad pinch.
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      setView((v) => {
        const min = Math.min(r.width / width, r.height / height) * 0.25;
        const scale = Math.max(min, Math.min(MAX_SCALE, v.scale * Math.exp(-e.deltaY * speed)));
        const k = scale / v.scale;
        return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, height]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (error) return;
    const pan = e.button === 1 || (e.button === 0 && (tool === 'hand' || space));
    if (pan) {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
      return;
    }
    if (e.button !== 0) return;
    const c = toCell(e.clientX, e.clientY);
    if (e.altKey) {
      const l = getLayers();
      const hit = l && cellAt(l, c.x, c.y);
      if (hit) onPick(hit);
      return;
    }
    if (tool === 'fill') {
      painter.fill(brush, c.x, c.y);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: 'paint', x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
    painter.begin(brush, c.x, c.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    hoverAt(e.clientX, e.clientY);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    else {
      const c = toCell(e.clientX, e.clientY);
      painter.move(brush, c.x, c.y);
    }
  };

  const onPointerUp = () => {
    if (drag.current?.kind === 'paint') painter.end();
    drag.current = null;
  };

  const panning = tool === 'hand' || space;
  const showBrush = cursor && !panning && tool === 'brush' && !error;
  const imgScale = backdrop ? (view.scale * width) / backdrop.width : 1;

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
      {/* The map's edge, so it shows even where the map is all ocean or hidden. */}
      <div
        className="pointer-events-none absolute border border-navy/25 bg-surface shadow-card"
        style={{ left: view.x - 1, top: view.y - 1, width: width * view.scale + 2, height: height * view.scale + 2 }}
      />
      {backdrop && backdropUrl && layers.backdrop && (
        <img
          src={backdropUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
          style={{ width: backdrop.width, height: backdrop.height, transform: `translate(${view.x}px, ${view.y}px) scale(${imgScale})`, opacity: layers.backdropOpacity }}
        />
      )}
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
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
