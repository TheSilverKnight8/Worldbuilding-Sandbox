import { useEffect, useMemo, useRef } from 'react';
import { GEN_BIOMES, type GeneratedMap } from '../lib/map/generate';
import { starterLook } from '../lib/map/biomes';
import { cliffDrawings, cliffWaterfalls, riversAtFalls } from '../lib/map/cliffs';
import { buildCoast } from '../lib/map/coast';
import type { Graph } from '../lib/map/graph';
import { onSpritesReady } from '../lib/map/icons';
import { NoisyEdges } from '../lib/map/noisy';
import { MapRenderer, type MapStyle, type Scene } from '../lib/map/render';
import { riverShapes } from '../lib/map/rivers';
import { mapIcons } from '../lib/map/scene';
import { computeHeights } from '../lib/map/terrain';

/** A generated map, drawn whole by the map's own renderer, before it is kept. */
export function MapPreview({ graph, seed, generated, style }: { graph: Graph; seed: number; generated: GeneratedMap; style: MapStyle }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useMemo<Scene>(() => {
    const noisy = new NoisyEdges(graph, seed);
    // The generator paints with the starter biomes; slot n is GEN_BIOMES[n - 1].
    const looks = [null, ...GEN_BIOMES.map((name) => starterLook(name))];
    const rivers = riverShapes(generated.rivers, graph, noisy);
    const falls = cliffWaterfalls(graph, noisy, generated.land, rivers, generated.cliffs, new Set());
    return {
      graph,
      land: generated.land,
      biome: generated.biome,
      coast: buildCoast(graph, generated.land, noisy),
      looks,
      icons: mapIcons(graph, generated.land, generated.biome, looks, seed, generated.icons, new Set(), rivers, generated.cliffs, falls),
      heights: computeHeights(graph, generated.land, generated.elevation, generated.icons, generated.cliffs),
      overlay: false,
      rivers: riversAtFalls(rivers, falls, graph.spacing),
      cliffs: cliffDrawings(generated.cliffs, graph, noisy, falls),
      noisy,
    };
  }, [graph, seed, generated]);

  useEffect(() => {
    const c = canvas.current!;
    const renderer = new MapRenderer(c);
    const draw = () => {
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(w / graph.width, h / graph.height);
      renderer.draw({ scale, x: (w - graph.width * scale) / 2, y: (h - graph.height * scale) / 2 }, scene, style);
    };
    draw();
    // Icon drawings made in the background: draw again once they are ready.
    onSpritesReady(draw);
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => {
      onSpritesReady(null);
      ro.disconnect();
    };
  }, [scene, style, graph]);

  return <canvas ref={canvas} className="block h-full w-full" data-testid="map-preview" />;
}
