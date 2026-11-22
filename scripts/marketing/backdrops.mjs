#!/usr/bin/env node
// Paints the stills of the marbled backdrops behind the product illustrations
// (artifacts/web/src/marketing/art/*.webp).
//
// The paint itself is a fragment shader, and it lives with the page:
// artifacts/web/src/marketing/client/paint-source.ts. The page runs it live;
// this script runs the very same source at time zero and saves the picture, so
// what shows before the script loads (and where there is no WebGL at all) is
// the first frame of what follows. To add or change a backdrop, edit VARIANTS
// in that file and run:
//
//   node scripts/marketing/backdrops.mjs --measure  # prints each variant's `range`
//   node scripts/marketing/backdrops.mjs            # writes art/*.webp (needs cwebp)
//   node scripts/marketing/backdrops.mjs <out dir>  # writes PNGs there instead
//
// See browser.mjs for how to run it. The browser is only used as a canvas.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FRAGMENT, STILL, VARIANTS, VERTEX, uniforms } from "../../artifacts/web/src/marketing/client/paint-source.ts";
import { launch } from "./browser.mjs";

const art = path.join(import.meta.dirname, "../../artifacts/web/src/marketing/art");
const measure = process.argv[2] === "--measure";
const toWebp = process.argv[2] === undefined;
const out = toWebp ? mkdtempSync(path.join(os.tmpdir(), "backdrops-")) : path.resolve(process.argv[2]);
if (!measure) mkdirSync(out, { recursive: true });

// The widest an illustration is drawn on the page, in CSS pixels. The live
// canvas holds `scale` pixels for each of those and the browser stretches it;
// the still is painted that small and stretched the same way, so the two are
// equally soft.
const FRAME_WIDTH = 815;

/** Runs in the browser: one frame of the shader, as a PNG or as its raw values. */
function paint({ vertex, fragment, uniforms, width, height, still, raw }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("This browser has no WebGL.");
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  for (const [name, kind, values] of uniforms) {
    const place = gl.getUniformLocation(program, name);
    if (kind.endsWith("v")) gl[`uniform${kind}`](place, values);
    else gl[`uniform${kind}`](place, ...values);
  }
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (raw) {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) values.push(pixels[i] / 255);
    return values.sort((a, b) => a - b);
  }
  const full = document.createElement("canvas");
  full.width = still.width;
  full.height = still.height;
  const ctx = full.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, still.width, still.height);
  return full.toDataURL("image/png");
}

// A headless browser has no GPU to hand: let it compute the shader instead.
const browser = await launch(["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]);
const page = await browser.newPage();
for (const [name, variant] of Object.entries(VARIANTS)) {
  // The hero's glow has no still. Its range is still worth measuring.
  if (variant.aura && !measure) continue;
  const width = Math.round(FRAME_WIDTH * variant.scale);
  const height = Math.round((width * STILL.height) / STILL.width);
  const frame = { width, height, time: 0, anchor: 0.5, pointer: [-1, -1], stir: [0, 0], raw: measure };
  const result = await page.evaluate(paint, {
    vertex: VERTEX,
    fragment: FRAGMENT,
    uniforms: uniforms(variant, frame),
    width,
    height,
    still: STILL,
    raw: measure,
  });
  if (measure) {
    // The 2nd and 98th percentiles, with a margin: the extremes are rare, and
    // the paint wanders a little outside its first frame as it moves.
    const at = (q) => result[Math.min(result.length - 1, Math.floor(q * result.length))];
    const lo = at(0.02);
    const hi = at(0.98);
    const margin = (hi - lo) * 0.12;
    console.log(
      `${name.padEnd(8)} range: [${(lo - margin).toFixed(3)}, ${(hi + margin).toFixed(3)}],   median ${at(0.5).toFixed(3)}  (now [${variant.range.join(", ")}])`,
    );
    continue;
  }
  const png = path.join(out, `${name}.png`);
  writeFileSync(png, Buffer.from(result.split(",")[1], "base64"));
  if (toWebp) {
    const webp = path.join(art, `${name}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "78", "-m", "6", png, "-o", webp]);
    console.log("wrote", webp);
  } else {
    console.log("wrote", png);
  }
}
await browser.close();
if (toWebp) rmSync(out, { recursive: true, force: true });
