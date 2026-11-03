import type { MapLayers, Rect } from './grid';

// Draws the map from its grids with WebGL 2, so it stays sharp and fast at any zoom.
//
// - The coastline is where elevation crosses sea level. Elevation is blended smoothly
//   between cell centers, so coasts are smooth curves, not cell squares.
// - Each cell's biome color comes from the palette (one color per biome slot). Near the
//   coast, land takes the nearest land cell's biome and ocean the nearest ocean cell's,
//   so colors never bleed across the coastline.
// - Ocean without a biome is shaded by depth. Relief shading lights land from the
//   northwest, from the slope of the elevation.

/** Where the map is on screen: a cell's top-left corner is at (x + cx * scale, y + cy * scale) CSS pixels. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface DrawOptions {
  biomes: boolean;
  relief: boolean;
  /** 0..1 */
  opacity: number;
}

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
precision highp usampler2D;

uniform isampler2D uElev;
uniform usampler2D uBiome;
uniform sampler2D uPalette;
uniform vec2 uSize;
uniform vec2 uOffset;
uniform float uScale;
uniform float uCanvasH;
uniform bool uBiomes;
uniform bool uRelief;
uniform float uOpacity;
out vec4 outColor;

const vec3 PLAIN_LAND = vec3(0.914, 0.863, 0.753);
const vec3 SHALLOW = vec3(0.612, 0.765, 0.855);
const vec3 DEEP = vec3(0.106, 0.227, 0.388);
const vec3 COAST = vec3(0.0, 0.149, 0.341);

ivec2 clampCell(ivec2 c) { return clamp(c, ivec2(0), ivec2(uSize) - 1); }
float elevAt(ivec2 c) { return float(texelFetch(uElev, clampCell(c), 0).r); }

float elevSmooth(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  return mix(mix(elevAt(i), elevAt(i + ivec2(1, 0)), f.x), mix(elevAt(i + ivec2(0, 1)), elevAt(i + ivec2(1, 1)), f.x), f.y);
}

// Cubic B-spline weights: they smooth the cell staircase into curves.
vec4 bspline(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  float u = 1.0 - t;
  return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

// Where the smoothed land value crosses SHORE is the coast. A lone land cell peaks at
// 4/9, so a value a little under 0.5 keeps one-cell islands on the map.
const float SHORE = 0.42;

/** 1 on land, 0 on ocean, smoothly in between. */
float landSmooth(ivec2 i, vec2 f) {
  vec4 wx = bspline(f.x);
  vec4 wy = bspline(f.y);
  float s = 0.0;
  for (int y = 0; y < 4; y++) {
    float row = 0.0;
    for (int x = 0; x < 4; x++) row += (elevAt(i + ivec2(x - 1, y - 1)) > 0.0 ? 1.0 : 0.0) * wx[x];
    s += row * wy[y];
  }
  return s;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 p = (frag - uOffset) / uScale;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uSize.x || p.y >= uSize.y) { outColor = vec4(0.0); return; }

  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  ivec2 c[4] = ivec2[4](i, i + ivec2(1, 0), i + ivec2(0, 1), i + ivec2(1, 1));
  float w[4] = float[4]((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  float e[4];
  float elev = 0.0;
  for (int k = 0; k < 4; k++) { e[k] = elevAt(c[k]); elev += e[k] * w[k]; }

  vec3 landCol = PLAIN_LAND;
  float depth = clamp(-elev / 6000.0, 0.0, 1.0);
  vec3 seaCol = mix(SHALLOW, DEEP, sqrt(depth));
  if (uBiomes) {
    float bestL = -1.0;
    float bestO = -1.0;
    for (int k = 0; k < 4; k++) {
      uint s = texelFetch(uBiome, clampCell(c[k]), 0).r;
      if (s == 0u) continue;
      vec4 pc = texelFetch(uPalette, ivec2(int(s), 0), 0);
      bool land = e[k] > 0.0;
      if (land && pc.a > 0.9 && w[k] > bestL) { bestL = w[k]; landCol = pc.rgb; }
      if (!land && pc.a > 0.4 && pc.a < 0.6 && w[k] > bestO) { bestO = w[k]; seaCol = pc.rgb * (1.0 - 0.12 * depth); }
    }
  }

  if (uRelief) {
    float ex = elevSmooth(p + vec2(1.0, 0.0)) - elevSmooth(p - vec2(1.0, 0.0));
    float ey = elevSmooth(p + vec2(0.0, 1.0)) - elevSmooth(p - vec2(0.0, 1.0));
    vec3 n = normalize(vec3(-ex / 1500.0, -ey / 1500.0, 1.0));
    vec3 light = normalize(vec3(-1.0, -1.0, 1.4));
    float shade = dot(n, light) / light.z;
    landCol *= clamp(mix(1.0, shade, 0.7), 0.45, 1.25);
  }

  float shore = landSmooth(i, f);
  float fw = max(fwidth(shore), 0.0001);
  float landAmt = smoothstep(SHORE - 0.5 * fw, SHORE + 0.5 * fw, shore);
  vec3 col = mix(seaCol, landCol, landAmt);
  float coast = 1.0 - smoothstep(0.0, 1.3 * fw, abs(shore - SHORE));
  col = mix(col, COAST, 0.75 * coast);
  outColor = vec4(col * uOpacity, uOpacity);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Map shader failed to compile.');
  return s;
}

export class MapRenderer {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private elevTex!: WebGLTexture;
  private biomeTex!: WebGLTexture;
  private paletteTex!: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private layers: MapLayers | null = null;
  private palette: Uint8Array = new Uint8Array(256 * 4);

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error('This browser cannot draw the map: WebGL 2 is not available. Check that hardware acceleration is on in Chrome’s settings.');
    this.gl = gl;
    this.init();
  }

  /** Sets everything up on the GPU. Called again if Chrome restores a lost drawing context. */
  init() {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Map shader failed to link.');
    this.program = program;
    gl.useProgram(program);

    // One triangle that covers the whole canvas.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['uElev', 'uBiome', 'uPalette', 'uSize', 'uOffset', 'uScale', 'uCanvasH', 'uBiomes', 'uRelief', 'uOpacity'])
      this.uniforms[name] = gl.getUniformLocation(program, name);

    const tex = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.elevTex = tex(0);
    this.biomeTex = tex(1);
    this.paletteTex = tex(2);
    gl.uniform1i(this.uniforms.uElev, 0);
    gl.uniform1i(this.uniforms.uBiome, 1);
    gl.uniform1i(this.uniforms.uPalette, 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.layers) this.setLayers(this.layers);
    this.setPalette(this.palette);
  }

  setLayers(layers: MapLayers) {
    const gl = this.gl;
    this.layers = layers;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.elevTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, layers.width, layers.height, 0, gl.RED_INTEGER, gl.SHORT, layers.elevation);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.biomeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, layers.width, layers.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, layers.biome);
  }

  /** Sends only the changed cells to the GPU. */
  update(r: Rect) {
    const l = this.layers;
    if (!l) return;
    const gl = this.gl;
    const x0 = Math.max(0, r.x0);
    const y0 = Math.max(0, r.y0);
    const w = Math.min(l.width, r.x1) - x0;
    const h = Math.min(l.height, r.y1) - y0;
    if (w <= 0 || h <= 0) return;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, l.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.elevTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED_INTEGER, gl.SHORT, l.elevation);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.biomeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, l.biome);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  setPalette(p: Uint8Array) {
    const gl = this.gl;
    this.palette = p;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, p);
  }

  draw(view: View, opts: DrawOptions) {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.layers || opts.opacity <= 0) return;
    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniform2f(u.uSize, this.layers.width, this.layers.height);
    gl.uniform2f(u.uOffset, view.x * dpr, view.y * dpr);
    gl.uniform1f(u.uScale, view.scale * dpr);
    gl.uniform1f(u.uCanvasH, h);
    gl.uniform1i(u.uBiomes, opts.biomes ? 1 : 0);
    gl.uniform1i(u.uRelief, opts.relief ? 1 : 0);
    gl.uniform1f(u.uOpacity, opts.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  get lost() {
    return this.gl.isContextLost();
  }
}
