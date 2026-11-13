// On-device dust measurement for a photo of a white sheet of paper.
// 1. find the paper (bright region), 2. estimate the clean-paper brightness per area
// (high percentile in a coarse grid, so dust doesn't drag it down), 3. mark pixels that
// are clearly darker than the clean paper around them as dust.

export interface DustMeasurement {
  coveragePercent: number;
  paperPercent: number; // share of the frame recognised as paper
  overlay: string; // data URL: the photo with dust highlighted
  specks: number; // separate dust particles / patches found
  largestPatchPercent: number; // largest single patch, % of the sheet
  lowerEdgeShare: number; // share of the dust in the lower third of the sheet (run-off build-up)
  pattern: string;
  width: number;
  height: number;
}

const MAX_SIDE = 640;
const GRID = 12;
const DARKER = 0.16; // 16% darker than local clean paper counts as dust

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

export function measureDust(img: HTMLImageElement | HTMLCanvasElement): DustMeasurement {
  const srcW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const srcH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const s = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * s));
  const h = Math.max(1, Math.round(srcH * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const d = pixels.data;
  const n = w * h;

  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];

  // --- paper mask: Otsu threshold on a blurred copy (specks vanish in the blur)
  const blurred = boxBlur(lum, w, h, Math.max(4, Math.round(Math.max(w, h) / 40)));
  const t = otsu(blurred);
  const paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) paper[i] = blurred[i] >= t ? 1 : 0;
  keepLargest(paper, w, h);
  const eroded = erode(paper, w, h, Math.max(3, Math.round(Math.max(w, h) / 90)));
  // fill holes (dust patches inside the sheet) so they count as paper
  fillHoles(eroded, w, h);

  // --- clean-paper reference: 90th percentile per grid cell, bilinear
  const cw = w / GRID;
  const ch = h / GRID;
  const ref = new Float32Array(GRID * GRID);
  let global: number[] = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const vals: number[] = [];
      for (let y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++)
        for (let x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) if (eroded[y * w + x]) vals.push(lum[y * w + x]);
      ref[gy * GRID + gx] = vals.length > 20 ? percentile(vals, 0.9) : NaN;
      global = global.concat(vals.length > 400 ? vals.filter((_, i) => i % 7 === 0) : vals);
    }
  }
  const fallback = global.length ? percentile(global, 0.9) : 255;
  for (let i = 0; i < ref.length; i++) if (!Number.isFinite(ref[i])) ref[i] = fallback;

  // --- classify
  let paperCount = 0;
  let dustCount = 0;
  const dustMask = new Uint8Array(n);
  let paperTop = h;
  let paperBottom = 0;
  const out = ctx.createImageData(w, h);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = i * 4;
      o[k] = d[k];
      o[k + 1] = d[k + 1];
      o[k + 2] = d[k + 2];
      o[k + 3] = 255;
      if (!eroded[i]) {
        // dim everything outside the sheet
        o[k] = d[k] * 0.35;
        o[k + 1] = d[k + 1] * 0.35;
        o[k + 2] = d[k + 2] * 0.35;
        continue;
      }
      paperCount++;
      if (y < paperTop) paperTop = y;
      if (y > paperBottom) paperBottom = y;
      const bg = bilinear(ref, (x + 0.5) / cw - 0.5, (y + 0.5) / ch - 0.5);
      if (lum[i] < bg * (1 - DARKER)) {
        dustCount++;
        dustMask[i] = 1;
        o[k] = 255;
        o[k + 1] = 92;
        o[k + 2] = 32;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  const sizes = componentSizes(dustMask, w, h).filter((size) => size >= 2);
  const largest = sizes.length ? Math.max(...sizes) : 0;
  const cut = paperTop + ((paperBottom - paperTop) * 2) / 3;
  let lower = 0;
  for (let y = Math.ceil(cut); y < h; y++) for (let x = 0; x < w; x++) lower += dustMask[y * w + x];
  const coveragePercent = paperCount ? (dustCount / paperCount) * 100 : 0;
  const largestPatchPercent = paperCount ? (largest / paperCount) * 100 : 0;
  const lowerEdgeShare = dustCount ? lower / dustCount : 0;
  return {
    coveragePercent,
    paperPercent: (paperCount / n) * 100,
    overlay: canvas.toDataURL("image/jpeg", 0.85),
    specks: sizes.length,
    largestPatchPercent,
    lowerEdgeShare,
    pattern: describePattern(coveragePercent, sizes.length, largestPatchPercent, lowerEdgeShare),
    width: w,
    height: h,
  };
}

/** Downscale a photo to a JPEG data URL for upload. */
export function toJpeg(img: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, maxSide = 1280, quality = 0.88): string {
  const sw = img instanceof HTMLVideoElement ? img.videoWidth : img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const sh = img instanceof HTMLVideoElement ? img.videoHeight : img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * s);
  c.height = Math.round(sh * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/** A synthetic dusty sheet of paper on a desk, for rehearsing without a camera. */
export function sampleDustyPaper(amount = 0.18): string {
  const W = 1200;
  const H = 900;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5b4a3d";
  g.fillRect(0, 0, W, H);
  // paper with a lighting gradient
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#f7f6f1");
  grad.addColorStop(1, "#dcdad2");
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.04);
  g.fillStyle = grad;
  g.fillRect(-460, -330, 920, 660);
  // dust: a soft film toward the bottom edge plus specks and a few clumps
  let seed = Math.floor(amount * 1e6) + 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const film = g.createLinearGradient(0, -330, 0, 330);
  film.addColorStop(0, "rgba(150,120,80,0)");
  film.addColorStop(1, `rgba(140,110,70,${0.25 + amount})`);
  g.fillStyle = film;
  g.fillRect(-460, 60, 920, 270);
  const specks = Math.round(amount * 9000);
  for (let i = 0; i < specks; i++) {
    const x = -455 + r() * 910;
    const y = -325 + Math.pow(r(), 0.6) * 650;
    const rad = 0.8 + Math.pow(r(), 3) * 5;
    g.fillStyle = `rgba(${90 + r() * 50},${70 + r() * 40},${45 + r() * 30},${0.55 + r() * 0.4})`;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < Math.round(amount * 40); i++) {
    const x = -400 + r() * 800;
    const y = -250 + r() * 560;
    const rad = 12 + r() * 30;
    const blob = g.createRadialGradient(x, y, 0, x, y, rad);
    blob.addColorStop(0, "rgba(110,85,55,0.85)");
    blob.addColorStop(1, "rgba(110,85,55,0)");
    g.fillStyle = blob;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.restore();
  return c.toDataURL("image/jpeg", 0.9);
}

function describePattern(coverage: number, specks: number, largest: number, lowerShare: number) {
  if (coverage < 0.5) return "No meaningful soiling found.";
  const parts: string[] = [];
  if (largest > Math.max(1.5, coverage * 0.3)) parts.push("concentrated in a large patch");
  else if (specks > 150) parts.push(`${specks} scattered specks across the surface`);
  else parts.push(`${specks} separate specks and spots`);
  if (lowerShare > 0.55) parts.push("heavier along the lower edge, where run-off collects");
  return parts.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".";
}

/** Maintenance advice for a coverage %. */
export function recommendationFor(coverage: number) {
  if (coverage < 3) return "No action needed; re-inspect on the next scheduled flight.";
  if (coverage < 8) return "Light soiling; monitor on the next flights.";
  if (coverage < 12) return "Below the cleaning threshold; include in the next routine wash.";
  if (coverage < 30) return "Cleaning scheduled: losses are significant, prioritise this table.";
  return "Clean immediately; check nearby tables for the same soiling source.";
}

function componentSizes(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

// ---------- helpers ----------
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    let cnt = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) { acc += src[y * w + x + r]; cnt++; }
      if (x - r - 1 >= 0) { acc -= src[y * w + x - r - 1]; cnt--; }
      if (x >= 0 && x < w) tmp[y * w + x] = acc / cnt;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    let cnt = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) { acc += tmp[(y + r) * w + x]; cnt++; }
      if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * w + x]; cnt--; }
      if (y >= 0 && y < h) out[y * w + x] = acc / cnt;
    }
  }
  return out;
}

function otsu(values: Float32Array) {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

function keepLargest(mask: Uint8Array, w: number, h: number) {
  const label = new Int32Array(mask.length);
  let next = 0;
  let bestLabel = 0;
  let bestSize = 0;
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    let size = 0;
    stack.push(i);
    label[i] = next;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !label[q]) { label[q] = next; stack.push(q); }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = label[i] === bestLabel ? 1 : 0;
}

function erode(mask: Uint8Array, w: number, h: number, r: number) {
  // separable min filter
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let run = 0;
    const row = y * w;
    const left = new Int32Array(w);
    for (let x = 0; x < w; x++) { run = mask[row + x] ? run + 1 : 0; left[x] = run; }
    run = 0;
    for (let x = w - 1; x >= 0; x--) {
      run = mask[row + x] ? run + 1 : 0;
      tmp[row + x] = left[x] > r && run > r ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    const up = new Int32Array(h);
    for (let y = 0; y < h; y++) { run = tmp[y * w + x] ? run + 1 : 0; up[y] = run; }
    run = 0;
    for (let y = h - 1; y >= 0; y--) {
      run = tmp[y * w + x] ? run + 1 : 0;
      out[y * w + x] = up[y] > r && run > r ? 1 : 0;
    }
  }
  return out;
}

function fillHoles(mask: Uint8Array, w: number, h: number) {
  // flood the background from the border; anything not reached and not paper is a hole
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (p: number) => { if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
}

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function bilinear(grid: Float32Array, gx: number, gy: number) {
  const x0 = Math.max(0, Math.min(GRID - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(GRID - 1, Math.floor(gy)));
  const x1 = Math.min(GRID - 1, x0 + 1);
  const y1 = Math.min(GRID - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, gx - x0));
  const fy = Math.max(0, Math.min(1, gy - y0));
  const a = grid[y0 * GRID + x0] * (1 - fx) + grid[y0 * GRID + x1] * fx;
  const b = grid[y1 * GRID + x0] * (1 - fx) + grid[y1 * GRID + x1] * fx;
  return a * (1 - fy) + b * fy;
}
