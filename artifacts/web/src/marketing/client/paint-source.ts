// The paint behind the product illustrations: one fragment shader and the
// palettes it is run with.
//
// It is fractal noise pushed around by more noise (domain warping, after Inigo
// Quilez), mapped through a colour ramp. Time moves the inner layers, so the
// marbling drifts; a pointer drags it a little where it passes.
//
// Two things use this file, so it holds no browser code and only syntax Node
// can run as it stands:
//   - client/paint.ts draws it live on the page;
//   - scripts/marketing/backdrops.mjs renders the same shader at time zero into
//     art/*.webp, the stills that show first and stay when there is no WebGL.
// Change a palette here and re-run that script, or the still and the live paint
// will not match.

/** `stops`: positions 0…1 and colours, lightest first. Always six. */
export interface Variant {
  seed: number;
  /** How much of the noise field the picture spans: lower is larger shapes. */
  zoom: number;
  /** How hard the layers push each other: higher is more veined. */
  warp: number;
  stops: [number, string][];
  /**
   * The lowest and highest values the noise takes in this picture, measured
   * (`backdrops.mjs --measure`): they are stretched over the whole ramp.
   */
  range: [number, number];
  /** Blend the noise into a top-to-bottom ramp: a sky rather than marble. */
  vertical?: boolean;
  /** Fade to nothing at the edges, for a glow that lies on the page. */
  aura?: boolean;
  /** Canvas pixels per CSS pixel. Paint is soft: it needs few. */
  scale: number;
  /** How fast it drifts. 1 is the pace of the illustrations. */
  speed?: number;
}

/**
 * Width over height of the stills. A frame of any other shape shows the still
 * with `background-size: cover`, and the shader crops itself the same way, so
 * the first live frame is the still it takes over from.
 */
export const STILL = { width: 1320, height: 920 };

export const VARIANTS: Record<string, Variant> = {
  copper: {
    seed: 3,
    zoom: 0.85,
    warp: 1.05,
    range: [0.405, 0.769],
    scale: 0.45,
    stops: [[0, "#f3e2cf"], [0.22, "#ecc9a8"], [0.42, "#dfa273"], [0.6, "#c98457"], [0.78, "#9a6444"], [1, "#6d4531"]],
  },
  greige: {
    seed: 9,
    zoom: 0.8,
    warp: 1.1,
    range: [0.33, 0.79],
    scale: 0.45,
    stops: [[0, "#e6ded2"], [0.22, "#cdbfaf"], [0.42, "#a99a8a"], [0.6, "#857769"], [0.78, "#5a4f47"], [1, "#35302c"]],
  },
  mauve: {
    seed: 17,
    zoom: 0.85,
    warp: 1.1,
    range: [0.283, 0.76],
    scale: 0.45,
    stops: [[0, "#dcd0d8"], [0.22, "#c2b0c0"], [0.42, "#a28ba0"], [0.6, "#806a84"], [0.78, "#5f4a66"], [1, "#412f47"]],
  },
  teal: {
    seed: 29,
    zoom: 0.8,
    warp: 1.1,
    range: [0.135, 0.845],
    scale: 0.45,
    stops: [[0, "#e6efe6"], [0.2, "#c5ddd3"], [0.4, "#8dbcb1"], [0.58, "#4f958f"], [0.78, "#236a70"], [1, "#143f49"]],
  },
  sand: {
    seed: 41,
    zoom: 0.8,
    warp: 1.0,
    range: [0.19, 0.7],
    scale: 0.45,
    stops: [[0, "#f4ecdf"], [0.25, "#e9d9bf"], [0.45, "#d8bd92"], [0.62, "#c2a071"], [0.8, "#9d7f58"], [1, "#74603f"]],
  },
  dusk: {
    seed: 57,
    zoom: 0.9,
    warp: 0.85,
    range: [0.281, 0.738],
    scale: 0.4,
    vertical: true,
    stops: [[0, "#141a2c"], [0.3, "#1f2942"], [0.5, "#3a3f5c"], [0.66, "#7d4f52"], [0.82, "#c46f47"], [1, "#eab07c"]],
  },
  // The light the hero's product window sits in. It has no still: the page
  // draws it with gradients until this arrives.
  aura: {
    seed: 71,
    zoom: 0.62,
    warp: 0.8,
    range: [0.38, 0.68],
    scale: 0.28,
    aura: true,
    speed: 1.5,
    stops: [[0, "#f4d3ae"], [0.22, "#ecae80"], [0.44, "#dc8d5f"], [0.64, "#c8898f"], [0.82, "#9c84ae"], [1, "#6fa9aa"]],
  },
};

export const VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_size;
uniform float u_time;
uniform float u_seed;
uniform float u_zoom;
uniform float u_warp;
uniform vec2 u_range;
uniform float u_vertical;
uniform float u_aura;
uniform float u_still;
uniform float u_anchor;
uniform vec3 u_stops[6];
uniform float u_at[6];
uniform vec2 u_pointer;
uniform vec2 u_stir;
uniform float u_raw;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two octaves: the layers that do the pushing. Kept smooth, so the paint
// folds in long strokes instead of creasing.
float flow(vec2 p) {
  return noise(p) * 0.72 + noise(p * vec2(2.03, 2.01) + vec2(11.7, 5.3)) * 0.28;
}

// Four octaves: the pigment itself.
float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int o = 0; o < 4; o++) {
    f += amp * noise(p);
    total += amp;
    p = p * vec2(2.03, 2.01) + vec2(11.7, 5.3);
    amp *= 0.4;
  }
  return f / total;
}

vec3 ramp(float t) {
  vec3 c = u_stops[0];
  for (int i = 1; i < 6; i++) {
    c = mix(c, u_stops[i], smoothstep(u_at[i - 1], u_at[i], t));
  }
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  uv.y = 1.0 - uv.y;
  float aspect = u_size.x / u_size.y;

  // The still is one shape and is laid out with "cover". Crop the field the
  // same way, so this picture at time zero is the still it replaces.
  vec2 st = uv;
  if (aspect > u_still) {
    float keep = u_still / aspect;
    st.y = u_anchor * (1.0 - keep) + uv.y * keep;
  } else {
    float keep = aspect / u_still;
    st.x = 0.5 * (1.0 - keep) + uv.x * keep;
  }
  vec2 p = vec2(st.x * u_still * 0.92, st.y * 1.15) * u_zoom + u_seed * vec2(0.731, 0.417);

  // Where the pointer is, the paint is pulled along its path and curls a little.
  vec2 away = (uv - u_pointer) * vec2(aspect, 1.0);
  float near = exp(-dot(away, away) * 7.0) * step(0.0, u_pointer.x);
  float curl = (u_stir.x * away.y - u_stir.y * away.x) * 2.2 * near;
  p -= u_stir * near;
  p += vec2(-away.y, away.x) * curl;

  // Time swings each layer around where it started rather than carrying it
  // off: the picture keeps its composition and never comes back the same.
  float t = u_time;
  vec2 d1 = 0.30 * vec2(sin(t * 0.23), cos(t * 0.19) - 1.0);
  vec2 d2 = 0.26 * vec2(cos(t * 0.17) - 1.0, sin(t * 0.29));
  vec2 d3 = 0.22 * vec2(sin(t * 0.13 + 2.0) - sin(2.0), sin(t * 0.21));
  vec2 q = vec2(flow(p + vec2(1.7, 9.2) + d1), flow(p + vec2(8.3, 2.8) + d2));
  vec2 r = vec2(
    flow(p + u_warp * 3.4 * q + vec2(1.2, 6.1) + d3),
    flow(p + u_warp * 3.4 * q + vec2(7.4, 3.9) - d1));
  float f = fbm(p + u_warp * 2.9 * r + d2) * 0.78 + r.x * 0.22;

  // For measuring a variant's range: the noise itself, as a grey.
  if (u_raw > 0.5) {
    gl_FragColor = vec4(vec3(f), 1.0);
    return;
  }

  // The noise lives in the middle of 0…1: spread it over the whole ramp.
  float v = clamp((f - u_range.x) / (u_range.y - u_range.x), 0.0, 1.0);
  // A sky: mostly the height, with the noise ruffling the horizon.
  v = mix(v, st.y * 0.87 + (v - 0.5) * 0.16 + 0.03, u_vertical);
  vec3 colour = ramp(clamp(v, 0.0, 1.0));

  float alpha = 1.0;
  if (u_aura > 0.5) {
    // A glow: warm on one side and cool on the other, wherever the noise goes,
    // brightest behind the middle and gone before any edge.
    colour = ramp(clamp(v * 0.62 + uv.x * 0.5 - 0.06, 0.0, 1.0));
    vec2 c = (uv - vec2(0.5, 0.54)) * vec2(1.1, 1.42);
    alpha = smoothstep(0.8, 0.1, length(c)) * (0.62 + 0.38 * q.y) * smoothstep(1.0, 0.78, uv.y) * 0.92;
  }
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

/** `#rrggbb` as three numbers in 0…1. */
export function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** What changes from one frame, or one canvas, to the next. */
export interface Frame {
  /** Canvas size in pixels. */
  width: number;
  height: number;
  time: number;
  /** Which part of the still stays in view when it is cropped top and bottom: 0.5 the middle, 1 the bottom. */
  anchor: number;
  /** Where the pointer is, 0…1 each way, or -1 when it is elsewhere; and its pull. */
  pointer: [number, number];
  stir: [number, number];
  /** Paint the noise itself instead of the colours (for measuring `range`). */
  raw?: boolean;
}

/** A uniform as WebGL wants it: its name, which `gl.uniform…` sets it, the values. */
export type Uniform = [name: string, kind: "1f" | "2f" | "1fv" | "3fv", values: number[]];

/**
 * Every uniform the shader reads. The page and the script that paints the
 * stills both send exactly this list, so neither can forget one.
 */
export function uniforms(v: Variant, f: Frame): Uniform[] {
  return [
    ["u_size", "2f", [f.width, f.height]],
    ["u_time", "1f", [f.time]],
    ["u_seed", "1f", [v.seed]],
    ["u_zoom", "1f", [v.zoom]],
    ["u_warp", "1f", [v.warp]],
    ["u_range", "2f", v.range],
    ["u_vertical", "1f", [v.vertical ? 1 : 0]],
    ["u_aura", "1f", [v.aura ? 1 : 0]],
    ["u_still", "1f", [STILL.width / STILL.height]],
    ["u_anchor", "1f", [f.anchor]],
    ["u_stops[0]", "3fv", v.stops.flatMap(([, hex]) => rgb(hex))],
    ["u_at[0]", "1fv", v.stops.map(([t]) => t)],
    ["u_pointer", "2f", f.pointer],
    ["u_stir", "2f", f.stir],
    ["u_raw", "1f", [f.raw ? 1 : 0]],
  ];
}
