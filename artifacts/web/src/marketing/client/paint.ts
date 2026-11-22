// The marbled backdrops, moving.
//
// Every `[data-paint]` element already shows a still (a WebP the stylesheet
// sets). This draws the same picture live on a canvas laid over it: the paint
// drifts, and a pointer passing over it drags it along. The first frame is the
// still, so there is nothing to see when it takes over.
//
// One WebGL context paints all of them. Browsers allow only a handful of
// contexts per page, so each backdrop is rendered in turn on a canvas that is
// never shown and copied onto its own 2D canvas. Only the ones on screen are
// painted, at a fraction of their size (paint is soft), every other frame.
//
// No WebGL, a lost context, or a visitor who asked for less motion: the stills
// simply stay.

import { $$, clamp, fine, lerp, still } from "./core";
import { FRAGMENT, VARIANTS, VERTEX, uniforms, type Variant } from "./paint-source";

/** Shader time per second of wall clock. */
const RATE = 0.7;

interface Surface {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  variant: Variant;
  /** Which edge of the still stays in view when the host is wider than it. */
  anchor: number;
  w: number;
  h: number;
  visible: boolean;
  /** Seconds of paint shown so far: it stops while off screen. */
  time: number;
  /** The pointer over it (0…1 each way), and how hard it is dragging. */
  px: number;
  py: number;
  over: boolean;
  stirX: number;
  stirY: number;
  shown: boolean;
  dirty: boolean;
}

/** Compiles the shader. Returns the program, or null where that fails. */
function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  // One triangle that covers the whole viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return program;
}

export function paint(): void {
  const hosts = $$<HTMLElement>("[data-paint]");
  const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (still || saving || hosts.length === 0 || !("IntersectionObserver" in window)) return;

  const stage = document.createElement("canvas");
  const gl = stage.getContext("webgl", {
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return;
  let program = link(gl);
  if (!program) return;
  /** Where each uniform lives in the program, looked up once. */
  const places = new Map<string, WebGLUniformLocation | null>();

  const surfaces: Surface[] = [];
  for (const host of hosts) {
    const variant = VARIANTS[host.dataset.paint ?? ""];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!variant || !ctx) continue;
    canvas.className = "paint";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    surfaces.push({
      host,
      canvas,
      ctx,
      variant,
      anchor: host.dataset.paintAnchor === "bottom" ? 1 : 0.5,
      w: 0,
      h: 0,
      visible: false,
      time: 0,
      px: -1,
      py: -1,
      over: false,
      stirX: 0,
      stirY: 0,
      shown: false,
      dirty: true,
    });
  }

  function size(s: Surface): void {
    const w = Math.max(2, Math.round(s.host.clientWidth * s.variant.scale));
    const h = Math.max(2, Math.round(s.host.clientHeight * s.variant.scale));
    if (w === s.w && h === s.h) return;
    s.w = s.canvas.width = w;
    s.h = s.canvas.height = h;
    s.dirty = true;
  }

  function draw(s: Surface): void {
    if (!program) return;
    if (stage.width < s.w || stage.height < s.h) {
      stage.width = Math.max(stage.width, s.w);
      stage.height = Math.max(stage.height, s.h);
    }
    gl!.viewport(0, 0, s.w, s.h);
    const frame = {
      width: s.w,
      height: s.h,
      time: s.time * RATE * (s.variant.speed ?? 1),
      anchor: s.anchor,
      pointer: [s.px, s.py] as [number, number],
      stir: [s.stirX, s.stirY] as [number, number],
    };
    for (const [name, kind, values] of uniforms(s.variant, frame)) {
      let place = places.get(name);
      if (place === undefined) places.set(name, (place = gl!.getUniformLocation(program, name)));
      if (kind === "1f") gl!.uniform1f(place, values[0]);
      else if (kind === "2f") gl!.uniform2f(place, values[0], values[1]);
      else if (kind === "1fv") gl!.uniform1fv(place, values);
      else gl!.uniform3fv(place, values);
    }
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    // The viewport sits in the bottom left corner of the stage.
    s.ctx.globalCompositeOperation = "copy";
    s.ctx.drawImage(stage, 0, stage.height - s.h, s.w, s.h, 0, 0, s.w, s.h);
    s.dirty = false;
    if (!s.shown) {
      s.shown = true;
      s.host.classList.add("is-painted");
    }
  }

  // ---- The pointer ----------------------------------------------------------
  const pointer = { x: 0, y: 0, known: false };
  if (fine) {
    window.addEventListener(
      "pointermove",
      (e) => {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.known = true;
      },
      { passive: true },
    );
    document.documentElement.addEventListener("pointerleave", () => (pointer.known = false));
  }

  /** Where the pointer is over a surface, and what its movement does to the paint. */
  function stir(s: Surface, dt: number): void {
    let goalX = 0;
    let goalY = 0;
    let over = false;
    if (pointer.known) {
      const r = s.host.getBoundingClientRect();
      const x = (pointer.x - r.left) / r.width;
      const y = (pointer.y - r.top) / r.height;
      over = x > -0.15 && x < 1.15 && y > -0.15 && y < 1.15;
      if (over) {
        if (s.over) {
          // Its speed, in widths per second, becomes a push on the paint.
          const aspect = r.width / r.height;
          goalX = clamp(((x - s.px) / dt) * 0.1 * aspect, -0.32, 0.32);
          goalY = clamp(((y - s.py) / dt) * 0.1, -0.32, 0.32);
        }
        s.px = x;
        s.py = y;
      }
    }
    s.over = over;
    // Quick to follow a push, slow to let go of it: the paint is thick.
    const pushing = Math.hypot(goalX, goalY) > Math.hypot(s.stirX, s.stirY);
    const k = 1 - Math.exp(-dt * (pushing ? 9 : 1.6));
    s.stirX = lerp(s.stirX, goalX, k);
    s.stirY = lerp(s.stirY, goalY, k);
    if (Math.abs(s.stirX) + Math.abs(s.stirY) < 0.0005) s.stirX = s.stirY = 0;
  }

  // ---- The loop -------------------------------------------------------------
  let frame = 0;
  let last = 0;
  let odd = false;
  let lost = false;

  function tick(now: number): void {
    frame = 0;
    const dt = clamp((now - last) / 1000, 0.001, 0.1);
    last = now;
    odd = !odd;
    let any = false;
    for (const s of surfaces) {
      if (!s.visible) continue;
      any = true;
      s.time += dt;
      stir(s, dt);
      // Drifting paint is fine at half the frame rate; paint being stirred is not.
      if (odd || s.dirty || s.stirX !== 0 || s.stirY !== 0) draw(s);
    }
    if (any && !lost) frame = requestAnimationFrame(tick);
  }

  function wake(): void {
    if (frame || lost) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  stage.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });
  stage.addEventListener("webglcontextrestored", () => {
    places.clear();
    program = link(gl);
    lost = program === null;
    for (const s of surfaces) s.dirty = true;
    wake();
  });

  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const s = surfaces.find((surface) => surface.host === entry.target);
        if (!s) continue;
        s.visible = entry.isIntersecting;
        if (s.visible) {
          size(s);
          s.dirty = true;
        }
      }
      wake();
    },
    { rootMargin: "160px 0px" },
  );
  const resized = "ResizeObserver" in window ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const s = surfaces.find((surface) => surface.host === entry.target);
      if (s) size(s);
    }
  }) : null;
  for (const s of surfaces) {
    seen.observe(s.host);
    resized?.observe(s.host);
  }
}
