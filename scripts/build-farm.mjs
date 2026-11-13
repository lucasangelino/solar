// Builds the isometric solar farm (anatomy kit) into src/generated/farm.ts.
// World units: 1 unit = 10 cm. x runs along the rows (east), y toward the viewer (south), z up.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso/iso-kit.mjs";
import * as G from "./iso/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "generated", "farm.ts");

const WIDTH = 1200;
const HEIGHT = 760;

// ---------- layout (true-ish dimensions, 1 unit = 10 cm) ----------
const ROWS = 4;
const COLS = 4;
const MODS = 8; // modules per table along the row (portrait, 2 high)
const MOD_W = 11.4; // 1.14 m
const MOD_L = 22.8; // 2.28 m
const GAP = 0.2;
const MOD_T = 0.45; // frame depth
const TILT = (25 * Math.PI) / 180;
const SLANT = MOD_L * 2 + GAP;
const TABLE_W = MODS * (MOD_W + GAP) - GAP;
const DEPTH = SLANT * Math.cos(TILT);
const RISE = SLANT * Math.sin(TILT);
const Z_LOW = 7.5; // module low edge 0.75 m above grade
const TABLE_STEP = TABLE_W + 9;
const ROW_PITCH = 74;
const ROW_FRONT = (r) => 44 + r * ROW_PITCH; // y of the low front edge
const TABLE_X = (c) => c * TABLE_STEP;
const ROW_NAMES = "ABCD";

const GROUND = { x: -112, y: -104, w: 640, d: 486, r: 14 };
const GROUND_Z = -16;
const FENCE = { x: -30, y: -34, w: 500, d: 340 };
const ROAD = { x: GROUND.x, y: 322, w: GROUND.w, d: 22, r: 0 };
const PAD = { x: 412, y: 112, w: 50, d: 92, r: 2 };
const TRACK = { x: 421, y: 204, w: 18, d: 102, r: 0 };

// camera
const AZIMUTH = 57;
const ELEVATION = 33;
const fitPoints = [
  ...k.boxCorners(GROUND, GROUND_Z, 0),
  [GROUND.x + 40, GROUND.y + 30, 62],
  [GROUND.x + GROUND.w - 30, GROUND.y + 40, 62],
];
const P = k.fitProjection(fitPoints, WIDTH, HEIGHT, { pad: 18, azimuth: AZIMUTH, elevation: ELEVATION });
const V = G.viewOf(P);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (p) => k.depthOf(p, P);
const path = (pts, closed = true) => k.pathOf(pts.map(at), closed);
const fmt = (n) => Math.round(n * 10) / 10;

// deterministic noise
let seed = 20261113;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// ---------- sorted item list ----------
const items = [];
const put = (key, svg) => items.push({ key, svg });

// ---------- ground block ----------
function groundBlock() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(GROUND, GROUND_Z, 2, P)}" style="filter:blur(14px)"/>`);
  const soil = k.slabOf(GROUND, GROUND_Z, -GROUND_Z - 3, P, 10, 0);
  out.push(`<g class="soil">${S(soil, { tone: "mid", inner: L(k.sideSeam(GROUND, -9, P, 10), { tone: "faint" }) + L(k.sideSeam(GROUND, -12.5, P, 10), { tone: "faint" }) })}</g>`);
  const turf = k.slabOf(GROUND, -3, 3, P, 10, 1.2);
  out.push(`<g class="turf">${S(turf, { tone: "mid" })}</g>`);
  // stones in the soil face
  const stones = [];
  for (let i = 0; i < 70; i++) {
    const side = rand() < 0.55;
    const z = GROUND_Z + 1.5 + rand() * 9.5;
    const p = side ? [GROUND.x + 10 + rand() * (GROUND.w - 20), GROUND.y + GROUND.d, z] : [GROUND.x + GROUND.w, GROUND.y + 10 + rand() * (GROUND.d - 20), z];
    stones.push(at(p));
  }
  out.push(`<g class="soil">${D(stones, { size: 0.7, tone: "lo" })}</g>`);
  return out.join("");
}

// grass tufts + mowing stripes on top
function grassTexture() {
  const out = [];
  const tufts = [];
  for (let i = 0; i < 900; i++) {
    const x = GROUND.x + 6 + rand() * (GROUND.w - 12);
    const y = GROUND.y + 6 + rand() * (GROUND.d - 12);
    if (y > ROAD.y - 2 && y < ROAD.y + ROAD.d + 2) continue;
    if (x > PAD.x - 3 && x < PAD.x + PAD.w + 3 && y > PAD.y - 3 && y < PAD.y + PAD.d + 3) continue;
    if (x > TRACK.x - 2 && x < TRACK.x + TRACK.w + 2 && y > TRACK.y - 2 && y < TRACK.y + TRACK.d) continue;
    tufts.push(at([x, y, 0]));
  }
  out.push(`<g class="grass-tufts">${D(tufts, { size: 0.55, tone: "lo" })}</g>`);
  // mowing stripes between rows (alternate tint bands)
  for (let r = 0; r < ROWS; r++) {
    const y0 = ROW_FRONT(r) + 4;
    const y1 = ROW_FRONT(r) + ROW_PITCH - DEPTH - 4;
    if (r === ROWS - 1) continue;
    out.push(`<path class="mow" d="${path([[FENCE.x + 6, y0, 0], [FENCE.x + FENCE.w - 70, y0, 0], [FENCE.x + FENCE.w - 70, y1, 0], [FENCE.x + 6, y1, 0]])}"/>`);
  }
  return out.join("");
}

function roadAndGravel() {
  const out = [];
  out.push(`<g class="asphalt">${S(k.slabOf(ROAD, 0, 0.35, P, 2), { tone: "lo", crease: "none" })}</g>`);
  // centre line dashes as closed slots
  const dashes = [];
  for (let x = ROAD.x + 8; x < ROAD.x + ROAD.w - 16; x += 18) dashes.push(k.planOutline({ x, y: ROAD.y + ROAD.d / 2 - 0.4, w: 8, d: 0.8, r: 0.3 }, 0.36, P, 2));
  out.push(`<g class="road-mark">${L(dashes.join(""), { tone: "hi" })}</g>`);
  out.push(`<g class="gravel">${S(k.slabOf(TRACK, 0, 0.3, P, 2), { tone: "lo", crease: "none" })}</g>`);
  out.push(`<g class="gravel">${S(k.slabOf({ x: TRACK.x - 6, y: ROAD.y - 16, w: TRACK.w + 12, d: 16, r: 3 }, 0, 0.3, P, 4), { tone: "lo", crease: "none" })}</g>`);
  out.push(`<g class="gravel">${S(k.slabOf(k.insetPlan(PAD, -6), 0, 0.3, P, 4), { tone: "lo", crease: "none" })}</g>`);
  const pebbles = [];
  for (let i = 0; i < 260; i++) {
    const inPad = rand() < 0.5;
    const box = inPad ? k.insetPlan(PAD, -5) : TRACK;
    pebbles.push(at([box.x + rand() * box.w, box.y + rand() * box.d, 0.3]));
  }
  out.push(`<g class="gravel">${D(pebbles, { size: 0.45, tone: "mid" })}</g>`);
  return out.join("");
}

// ---------- PV table ----------
const UX = [1, 0, 0];
const UP = [0, -Math.cos(TILT), Math.sin(TILT)]; // up the slope (toward the back)
const NORMAL = [0, Math.sin(TILT), Math.cos(TILT)];
const tableOrigin = (r, c) => [TABLE_X(c), ROW_FRONT(r), Z_LOW];
const onPanel = (o, along, up, off = 0) => [o[0] + along, o[1] + UP[1] * up + NORMAL[1] * off, o[2] + UP[2] * up + NORMAL[2] * off];

function module(o, along, up) {
  // module frame as a prism: polygon in (u = -x, v = up-slope), extruded along the normal
  const F = G.frameOf(onPanel(o, along + MOD_W, up), NORMAL, [-1, 0, 0], UP);
  const frame = G.prismOf(F, [[0, 0], [MOD_W, 0], [MOD_W, MOD_L], [0, MOD_L]], 0, MOD_T, P);
  const out = [S(frame, { tone: "mid", crease: "lo" })];
  const inset = 0.55;
  const glass = [
    onPanel(o, along + inset, up + inset, MOD_T),
    onPanel(o, along + MOD_W - inset, up + inset, MOD_T),
    onPanel(o, along + MOD_W - inset, up + MOD_L - inset, MOD_T),
    onPanel(o, along + inset, up + MOD_L - inset, MOD_T),
  ];
  const glassD = path(glass);
  out.push(`<path class="pv-glass" d="${glassD}"/>`);
  // cells: 6 x 12 half-cut grid; lines run edge to edge of the glass
  const cols = 6;
  const rows = 12;
  const cw = (MOD_W - inset * 2) / cols;
  const ch = (MOD_L - inset * 2) / rows;
  const lines = [];
  for (let i = 1; i < cols; i++) lines.push(path([onPanel(o, along + inset + cw * i, up + inset, MOD_T), onPanel(o, along + inset + cw * i, up + MOD_L - inset, MOD_T)], false));
  for (let j = 1; j < rows; j++) lines.push(path([onPanel(o, along + inset, up + inset + ch * j, MOD_T), onPanel(o, along + MOD_W - inset, up + inset + ch * j, MOD_T)], false));
  out.push(`<path class="pv-cells" d="${lines.join("")}"/>`);
  // half-cut split line (slightly stronger)
  out.push(`<path class="pv-split" d="${path([onPanel(o, along + inset, up + MOD_L / 2, MOD_T), onPanel(o, along + MOD_W - inset, up + MOD_L / 2, MOD_T)], false)}"/>`);
  // glare sheen: a soft diagonal band
  const sheen = [
    onPanel(o, along + inset, up + MOD_L * 0.62, MOD_T),
    onPanel(o, along + inset + (MOD_W - 2 * inset) * 0.55, up + MOD_L - inset, MOD_T),
    onPanel(o, along + inset + (MOD_W - 2 * inset) * 0.85, up + MOD_L - inset, MOD_T),
    onPanel(o, along + inset, up + MOD_L * 0.4, MOD_T),
  ];
  out.push(`<path class="pv-sheen" d="${path(sheen)}"/>`);
  return { svg: out.join(""), glassD };
}

function table(r, c) {
  const id = `${ROW_NAMES[r]}${c + 1}`;
  const o = tableOrigin(r, c);
  const back = [];
  const front = [];
  // posts every ~23 units, front (short) and rear (tall) pairs with a rafter and brace
  const postXs = [4, 27, 46.3, 65.6, 88.6];
  const rafterUp = [1.5, SLANT - 1.5];
  const purlinUps = [SLANT * 0.21, SLANT * 0.79];
  const underZ = (up) => o[2] + UP[2] * up - 1.0; // beneath the module back
  const underY = (up) => o[1] + UP[1] * up;
  for (const px of postXs) {
    const x = o[0] + px;
    const yF = underY(rafterUp[0]) - 1.4;
    const yR = underY(rafterUp[1]) - 1.4;
    const zF = underZ(rafterUp[0]) - 2.6;
    const zR = underZ(rafterUp[1]) - 2.6;
    // pile collars (concrete) + posts
    back.push({ key: depth([x, yR, 0]), svg: S(k.cylinder(x, yR + 0.7, 1.7, 0, 0.9, P, 18), { tone: "lo" }) + S(k.slabOf({ x: x - 0.6, y: yR, w: 1.2, d: 1.4, r: 0.2 }, 0.9, zR - 0.9, P, 2), { tone: "mid", crease: "none" }) });
    // diagonal brace from rear post foot region to rafter middle
    const bA = [x, yR + 0.7, 3.2];
    const bB = [x, underY(SLANT * 0.5), underZ(SLANT * 0.5) - 2.8];
    const braceDir = G.unit3(G.sub3(bB, bA));
    const braceLen = G.len3(G.sub3(bB, bA));
    const FB = G.frameOf(bA, braceDir, [1, 0, 0], G.unit3(G.cross3(braceDir, [1, 0, 0])));
    back.push({ key: depth(G.lerp3(bA, bB, 0.5)) - 0.5, svg: S(G.prismOf(FB, [[-0.35, -0.35], [0.35, -0.35], [0.35, 0.35], [-0.35, 0.35]], 0, braceLen, P), { tone: "mid", crease: "none" }) });
    front.push({ key: depth([x, yF, 0]), svg: S(k.cylinder(x, yF + 0.7, 1.7, 0, 0.9, P, 18), { tone: "lo" }) + S(k.slabOf({ x: x - 0.6, y: yF, w: 1.2, d: 1.4, r: 0.2 }, 0.9, zF - 0.9, P, 2), { tone: "mid", crease: "none" }) });
    // rafter along the slope (post tops)
    const rA = [x, yF + 0.7, zF];
    const rB = [x, yR + 0.7, zR];
    const rd = G.unit3(G.sub3(rB, rA));
    const FR = G.frameOf(rA, rd, [1, 0, 0], G.unit3(G.cross3(rd, [1, 0, 0])));
    back.push({ key: depth(G.lerp3(rA, rB, 0.5)) + 0.5, svg: S(G.prismOf(FR, [[-0.7, 0], [0.7, 0], [0.7, 2.4], [-0.7, 2.4]], -1.5, G.len3(G.sub3(rB, rA)) + 1.5, P), { tone: "mid", crease: "faint" }) });
  }
  // purlins along the row (box sections under the modules)
  const purlins = purlinUps
    .map((up) => S(k.slabOf({ x: o[0] - 1, y: underY(up) - 0.8, w: TABLE_W + 2, d: 1.6, r: 0.2 }, underZ(up) - 1.6, 1.6, P, 2), { tone: "mid", crease: "faint" }))
    .join("");
  // modules
  const mods = [];
  const glassPaths = [];
  for (let row = 0; row < 2; row++) {
    for (let m = 0; m < MODS; m++) {
      const mod = module(o, m * (MOD_W + GAP), row * (MOD_L + GAP));
      mods.push(mod.svg);
      glassPaths.push(mod.glassD);
    }
  }
  // mid / end clamps on the purlin lines
  const clamps = [];
  for (const up of purlinUps.flatMap((u) => [u, u + MOD_L + GAP]).filter((u) => u < SLANT)) {
    for (let m = 0; m <= MODS; m++) {
      const along = m * (MOD_W + GAP) - GAP / 2;
      const a = onPanel(o, along - 0.7, up - 0.9, MOD_T);
      const b = onPanel(o, along + 0.7, up - 0.9, MOD_T);
      const cc = onPanel(o, along + 0.7, up + 0.9, MOD_T);
      const d = onPanel(o, along - 0.7, up + 0.9, MOD_T);
      clamps.push(path([a, b, cc, d]));
    }
  }
  // table outline (for selection) and dust overlay
  const corners = [onPanel(o, -0.3, -0.3, MOD_T), onPanel(o, TABLE_W + 0.3, -0.3, MOD_T), onPanel(o, TABLE_W + 0.3, SLANT + 0.3, MOD_T), onPanel(o, -0.3, SLANT + 0.3, MOD_T)];
  const outline = path(corners);
  // id plate on the front-left post
  const centre = onPanel(o, TABLE_W / 2, SLANT / 2, MOD_T);
  const svg =
    back.sort((a, b) => a.key - b.key).map((i) => i.svg).join("") +
    purlins +
    front.sort((a, b) => a.key - b.key).map((i) => i.svg).join("") +
    `<g class="pv-mods">${mods.join("")}</g>` +
    `<path class="pv-clamp" d="${clamps.join("")}"/>` +
    `<g class="pv-dust"><path class="pv-dust-tint" d="${glassPaths.join("")}"/><path class="pv-dust-speck" d="${glassPaths.join("")}"/></g>` +
    `<path class="pv-hit" d="${outline}"/>` +
    `<path class="pv-outline" d="${outline}"/>`;
  return {
    id,
    row: r,
    col: c,
    centre,
    screen: at(centre),
    key: depth([o[0] + TABLE_W / 2, o[1] - DEPTH / 2, 0]),
    svg: `<g class="pv-table" data-table="${id}" tabindex="0" role="button" aria-label="Table ${id}">${svg}</g>`,
  };
}

// ---------- combiner boxes at the east end of each row ----------
function combiner(r) {
  const x = TABLE_X(COLS - 1) + TABLE_W + 5;
  const y = ROW_FRONT(r) - DEPTH / 2;
  const out = [];
  out.push(S(k.cylinder(x, y, 1.6, 0, 0.8, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf({ x: x - 0.5, y: y - 0.5, w: 1, d: 1, r: 0.2 }, 0.8, 9, P, 2), { tone: "mid", crease: "none" }));
  const box = { x: x - 2.2, y: y - 0.5, w: 4.4, d: 3.2, r: 0.4 };
  out.push(S(k.slabOf(box, 8, 6, P, 3, 0.4), { tone: "hi", crease: "lo", inner: L(k.sideSeam(box, 12.6, P, 3), { tone: "faint" }) }));
  out.push(D([at([x - 1.5, y + 2.7, 13]), at([x + 1.5, y + 2.7, 13]), at([x - 1.5, y + 2.7, 9]), at([x + 1.5, y + 2.7, 9])], { size: 0.35, tone: "mid" }));
  out.push(D([at([x, y + 2.75, 10.2])], { size: 0.6, tone: "hi" }));
  return { key: depth([x, y, 0]), svg: out.join("") };
}

// cable tray from the combiner column to the inverter pad
function cableTray() {
  const x = TABLE_X(COLS - 1) + TABLE_W + 5;
  const y0 = ROW_FRONT(0) - DEPTH / 2;
  const y1 = PAD.y + 10;
  const out = [];
  const tray = { x: x + 2.5, y: y0, w: 3, d: ROW_FRONT(ROWS - 1) - DEPTH / 2 - y0, r: 0.3 };
  for (let y = y0 + 6; y < tray.y + tray.d; y += 18) out.push(S(k.slabOf({ x: tray.x + 1, y: y, w: 1, d: 1, r: 0.2 }, 0, 2.2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(tray, 2.2, 1.2, P, 2), { tone: "mid", crease: "faint" }));
  out.push(L(k.onTop([[tray.x + 0.8, tray.y], [tray.x + 0.8, tray.y + tray.d]], 3.4, P) + k.onTop([[tray.x + 2.2, tray.y], [tray.x + 2.2, tray.y + tray.d]], 3.4, P), { tone: "faint" }));
  // spur to the pad
  const spur = { x: tray.x + 3, y: y1, w: PAD.x - tray.x - 3, d: 3, r: 0.3 };
  out.push(S(k.slabOf(spur, 2.2, 1.2, P, 2), { tone: "mid", crease: "faint" }));
  return { key: depth([x + 4, (y0 + y1) / 2, 0]) - 30, svg: out.join("") };
}

// ---------- inverter station: container + transformer on a concrete pad ----------
function inverterStation() {
  const parts = [];
  const pad = { x: PAD.x, y: PAD.y, w: PAD.w, d: PAD.d, r: 1.5 };
  parts.push({ key: -1e6, svg: S(k.slabOf(pad, 0, 1.6, P, 3, 0.6), { tone: "lo", crease: "faint", inner: L(k.sideSeam(pad, 0.8, P, 3), { tone: "faint" }) }) });
  // container (skid inverter)
  const box = { x: PAD.x + 6, y: PAD.y + 6, w: 30, d: 52, r: 0.6 };
  const z0 = 1.6;
  const h = 25;
  const inner = [];
  // corrugation ribs on the visible long face (y = box.y + box.d side faces +y? visible face is +x and +y)
  for (let y = box.y + 3; y < box.y + box.d - 2; y += 2.2) inner.push(k.segment([box.x + box.w, y, z0], [box.x + box.w, y, z0 + h], P));
  for (let x = box.x + 3; x < box.x + box.w - 2; x += 2.2) inner.push(k.segment([x, box.y + box.d, z0], [x, box.y + box.d, z0 + h], P));
  parts.push({ key: depth([box.x + box.w / 2, box.y + box.d / 2, 0]), svg: `<g class="container">${S(k.slabOf(box, z0, h, P, 2, 0.6), { tone: "hi", crease: "lo", inner: L(inner.join(""), { tone: "faint" }) + L(k.sideSeam(box, z0 + h - 1.6, P, 2), { tone: "lo" }) })}</g>` });
  // doors on the +x face
  const doorY = [box.y + 8, box.y + 22, box.y + 36];
  const doors = [];
  const handles = [];
  for (const y of doorY) {
    const fx = box.x + box.w + 0.05;
    doors.push(k.pathOf([at([fx, y, z0 + 1.2]), at([fx, y + 11, z0 + 1.2]), at([fx, y + 11, z0 + 21]), at([fx, y, z0 + 21])], true));
    doors.push(k.pathOf([at([fx, y + 2, z0 + 15]), at([fx, y + 9, z0 + 15]), at([fx, y + 9, z0 + 19]), at([fx, y + 2, z0 + 19])], true));
    handles.push(at([fx, y + 9.6, z0 + 11]));
  }
  parts.push({ key: depth([box.x + box.w, box.y + box.d / 2, 0]) + 0.1, svg: `<g class="container-door">${doors.map((d) => `<path class="door" d="${d}"/>`).join("")}</g>` + D(handles, { size: 0.7, tone: "hi" }) });
  // roof AC units
  for (const y of [box.y + 8, box.y + 30]) {
    const ac = { x: box.x + 6, y, w: 14, d: 12, r: 0.6 };
    parts.push({ key: depth([ac.x, ac.y, z0 + h]) + 200, svg: S(k.slabOf(ac, z0 + h, 4.5, P, 2, 0.4), { tone: "mid", crease: "lo" }) + L(k.ring(ac.x + 7, ac.y + 6, 4.2, z0 + h + 4.5, P, 32) + k.ring(ac.x + 7, ac.y + 6, 1.2, z0 + h + 4.5, P, 16), { tone: "lo" }) + L(G.spokesOf(G.frameOf([ac.x + 7, ac.y + 6, z0 + h + 4.5], [0, 0, 1], [1, 0, 0], [0, 1, 0]), 0, 1.4, 4, 6, P, { sweep: 0.4 }), { tone: "lo" }) });
  }
  // transformer with radiator fins
  const tx = { x: PAD.x + 10, y: PAD.y + 66, w: 22, d: 18, r: 1 };
  parts.push({ key: depth([tx.x + tx.w / 2, tx.y + tx.d / 2, 0]), svg: S(k.slabOf(tx, z0, 17, P, 3, 0.5), { tone: "hi", crease: "lo", inner: L(k.sideSeam(tx, z0 + 15, P, 3), { tone: "faint" }) }) });
  const fins = [];
  for (let x = tx.x + 2; x <= tx.x + tx.w - 2; x += 2.4) fins.push({ key: depth([x, tx.y + tx.d + 2, 0]) + 0.2, svg: S(k.slabOf({ x: x - 0.3, y: tx.y + tx.d, w: 0.6, d: 4.5, r: 0.1 }, z0 + 2, 12, P, 1), { tone: "mid", crease: "none" }) });
  parts.push(...fins);
  // bushings on top
  for (const [bx, by] of [[tx.x + 6, tx.y + 6], [tx.x + 11, tx.y + 6], [tx.x + 16, tx.y + 6]]) {
    const F = G.frameOf([bx, by, z0 + 17], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    parts.push({ key: depth([bx, by, z0 + 17]) + 300, svg: S(G.solidOf([[0, 1.3], [1.2, 1.3], [1.2, 1.0], [2.0, 1.2], [2.6, 0.9], [3.4, 1.1], [4.0, 0.8], [4.8, 1.0], [5.4, 0.55]], F, P), { tone: "hi", crease: "lo" }) });
  }
  // conduit stubs
  return parts;
}

// ---------- fence ----------
function fence() {
  const list = [];
  const posts = [];
  const step = 20;
  const gate = [TRACK.x - 4, TRACK.x + TRACK.w + 4];
  const edges = [
    [[FENCE.x, FENCE.y], [FENCE.x + FENCE.w, FENCE.y]],
    [[FENCE.x + FENCE.w, FENCE.y], [FENCE.x + FENCE.w, FENCE.y + FENCE.d]],
    [[FENCE.x, FENCE.y + FENCE.d], [FENCE.x + FENCE.w, FENCE.y + FENCE.d]],
    [[FENCE.x, FENCE.y], [FENCE.x, FENCE.y + FENCE.d]],
  ];
  const H = 20;
  edges.forEach(([a, b], e) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.round(len / step);
    for (let i = 0; i < n; i++) {
      const p = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      const q = [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (e === 2 && mid[0] > gate[0] && mid[0] < gate[1]) continue;
      // chain-link mesh as a light hatch + 3 wires
      const mesh = [];
      const cells = Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2.5);
      for (let j = 0; j <= cells; j++) {
        const t0 = j / cells;
        const x0 = p[0] + (q[0] - p[0]) * t0;
        const y0 = p[1] + (q[1] - p[1]) * t0;
        mesh.push(k.segment([x0, y0, 1], [x0, y0, H - 1], P));
      }
      const wires = [1, H / 2, H - 1].map((z) => k.segment([p[0], p[1], z], [q[0], q[1], z], P)).join("");
      list.push({ key: depth([mid[0], mid[1], 0]), svg: `<path class="fence-mesh" d="${mesh.join("")}"/>` + L(wires, { tone: "mid" }) });
    }
    for (let i = 0; i <= n; i++) posts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  });
  // gate posts
  posts.push([gate[0], FENCE.y + FENCE.d], [gate[1], FENCE.y + FENCE.d]);
  const seen = new Set();
  for (const [x, y] of posts) {
    const id = `${fmt(x)},${fmt(y)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (y === FENCE.y + FENCE.d && x > gate[0] + 0.1 && x < gate[1] - 0.1) continue;
    list.push({ key: depth([x, y, 0]) + 0.05, svg: S(k.cylinder(x, y, 0.75, 0, H + 1, P, 12), { tone: "mid", crease: "none" }) + S(k.cylinder(x, y, 0.95, H + 1, 0.6, P, 12), { tone: "mid" }) });
  }
  return list;
}

// ---------- weather station + CCTV pole ----------
function weatherStation() {
  const x = FENCE.x + 14;
  const y = FENCE.y + FENCE.d - 14;
  const out = [];
  out.push(S(k.slabOf({ x: x - 3, y: y - 3, w: 6, d: 6, r: 0.4 }, 0, 1, P, 2), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 0.7, 1, 34, P, 14), { tone: "mid", crease: "none" }));
  // logger box
  out.push(S(k.slabOf({ x: x - 2, y: y + 0.7, w: 4, d: 2, r: 0.3 }, 10, 5, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  // cross arm + pyranometer (tilted plane-of-array reference) + anemometer
  out.push(S(k.slabOf({ x: x - 7, y: y - 0.4, w: 14, d: 0.8, r: 0.2 }, 33, 0.8, P, 2), { tone: "mid", crease: "none" }));
  const pyr = G.frameOf([x - 6, y, 33.8], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  out.push(S(G.solidOf([[0, 1.4], [0.6, 1.4], [0.6, 0.8], [1.3, 0.75, 1], [1.7, 0.4, 1], [1.9, 0.0001, 1]], pyr, P), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(x + 6, y, 0.25, 33.8, 3, P, 10), { tone: "mid", crease: "none" }));
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const cx = x + 6 + Math.cos(a) * 2.2;
    const cy = y + Math.sin(a) * 2.2;
    out.push(L(k.segment([x + 6, y, 36.8], [cx, cy, 36.8], P), { tone: "mid" }));
    out.push(S(G.sphereOf([cx, cy, 36.8], 0.65, P), { tone: "hi" }));
  }
  // small PV reference cell tilted like the array
  return { key: depth([x, y, 0]), svg: out.join("") };
}

function cctv(x, y) {
  const out = [];
  out.push(S(k.cylinder(x, y, 1.2, 0, 0.8, P, 14), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 0.55, 0.8, 38, P, 12), { tone: "mid", crease: "none" }));
  const F = G.frameOf([x, y, 37.5], G.unit3([0.5, 0.6, -0.25]), [0, 0, 1], G.unit3(G.cross3(G.unit3([0.5, 0.6, -0.25]), [0, 0, 1])));
  out.push(S(G.solidOf([[0, 1.1], [3.6, 1.1], [3.6, 0.8], [4.0, 0.8]], F, P), { tone: "hi", crease: "lo" }));
  return { key: depth([x, y, 0]), svg: out.join("") };
}

// ---------- trees ----------
function broadleaf(x, y, size, variant) {
  const out = [];
  const h = 10 + size * 0.8;
  out.push(`<path class="iso-halo tree-shadow" d="${k.haloOf({ x: x - size * 1.3 + 4, y: y - size * 0.6 + 3, w: size * 2.6, d: size * 2, r: size }, 0, 0.1, P)}"/>`);
  out.push(`<g class="bark">${S(k.cylinder(x, y, 1.3 + size * 0.06, 0, h, P, 16), { tone: "mid", crease: "none" })}</g>`);
  // branch stubs
  out.push(`<g class="bark">${S(k.cylinder(x + 1.6, y + 0.6, 0.6, h - 3, 3, P, 10), { tone: "mid", crease: "none" })}</g>`);
  const lobes = [];
  const n = 5 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + variant;
    const rr = size * (0.45 + ((i * 37 + variant * 11) % 10) / 40);
    lobes.push([x + Math.cos(a) * size * 0.55, y + Math.sin(a) * size * 0.55, h + size * 0.35 + ((i * 7) % 5) * 0.6, rr]);
  }
  lobes.push([x, y, h + size * 0.95, size * 0.62]);
  lobes.sort((a, b) => depth(a) - depth(b));
  out.push(`<g class="foliage">${lobes.map(([lx, ly, lz, r]) => S(G.sphereOf([lx, ly, lz], r, P, { steps: 40 }), { tone: "mid", crease: "none" })).join("")}</g>`);
  return { key: depth([x, y, 0]), svg: out.join("") };
}

function pine(x, y, size) {
  const out = [];
  out.push(`<path class="iso-halo tree-shadow" d="${k.haloOf({ x: x - size + 3, y: y - size * 0.6 + 2, w: size * 2, d: size * 1.5, r: size * 0.7 }, 0, 0.1, P)}"/>`);
  out.push(`<g class="bark">${S(k.cylinder(x, y, 1.1, 0, 8, P, 14), { tone: "mid", crease: "none" })}</g>`);
  const F = G.frameOf([x, y, 6], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const tiers = [
    [0, size, size * 1.4],
    [size * 0.95, size * 0.8, size * 1.25],
    [size * 1.8, size * 0.6, size * 1.1],
  ];
  out.push(`<g class="foliage dark">${tiers.map(([s, r, hgt]) => S(G.solidOf([[s, r], [s + hgt * 0.15, r * 0.92, 1], [s + hgt * 0.6, r * 0.42, 1], [s + hgt, 0.0001]], F, P), { tone: "mid", crease: "none" })).join("")}</g>`);
  return { key: depth([x, y, 0]), svg: out.join("") };
}

// ---------- drone (built at the origin, moved live) ----------
function drone() {
  const out = [];
  const armLen = 6.4;
  const arms = [45, 135, 225, 315].map((deg) => (deg * Math.PI) / 180);
  const sorted = [...arms].sort((a, b) => depth([Math.cos(a), Math.sin(a), 0]) - depth([Math.cos(b), Math.sin(b), 0]));
  const armSvg = (a) => {
    const dir = [Math.cos(a), Math.sin(a), 0];
    const side = [-Math.sin(a), Math.cos(a)];
    const ring = [
      [side[0] * 0.55, side[1] * 0.55],
      [dir[0] * armLen + side[0] * 0.45, dir[1] * armLen + side[1] * 0.45],
      [dir[0] * armLen - side[0] * 0.45, dir[1] * armLen - side[1] * 0.45],
      [-side[0] * 0.55, -side[1] * 0.55],
    ];
    const ex = dir[0] * armLen;
    const ey = dir[1] * armLen;
    return (
      S(k.extrude(ring, 0.3, 0.8, P), { tone: "mid", crease: "none" }) +
      S(k.cylinder(ex, ey, 1.0, 0.2, 1.6, P, 16), { tone: "mid" }) +
      `<path class="rotor-blur" d="${k.ring(ex, ey, 3.6, 2.0, P, 40)}"/>` +
      L(k.lineOnTop([ex - 3.4, ey], [ex + 3.4, ey], 2.0, P), { tone: "hi" }) +
      D([at([ex, ey, 2.0])], { size: 0.6, tone: "hi" })
    );
  };
  const behind = sorted.slice(0, 2);
  const ahead = sorted.slice(2);
  out.push(behind.map(armSvg).join(""));
  const body = { x: -2.6, y: -3.4, w: 5.2, d: 6.8, r: 1.6 };
  out.push(S(k.slabOf(body, -0.2, 2.2, P, 4, 0.5), { tone: "hi", lit: true, crease: "lo" }));
  out.push(S(k.slabOf(k.insetPlan(body, 1.2), 2.0, 0.8, P, 4, 0.3), { tone: "hi", lit: true, crease: "lo" }));
  // gimbal camera
  out.push(S(k.slabOf({ x: -0.6, y: 2.2, w: 1.2, d: 1.2, r: 0.3 }, -1.4, 1.2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(G.sphereOf([0, 3.2, -2.2], 1.25, P, { steps: 32 }), { tone: "mid" }));
  out.push(D([at([0.45, 4.3, -2.2])], { size: 0.55, tone: "hi" }));
  out.push(ahead.map(armSvg).join(""));
  out.push(D([at([2.4, 3.2, 1.0])], { size: 0.5, tone: "hi", pulse: true }));
  return out.join("");
}

// ---------- assemble ----------
const tables = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) tables.push(table(r, c));
tables.forEach((t) => put(t.key, t.svg));
for (let r = 0; r < ROWS; r++) {
  const cb = combiner(r);
  put(cb.key, cb.svg);
}
const tray = cableTray();
put(tray.key, tray.svg);
for (const p of inverterStation()) put(p.key === -1e6 ? depth([PAD.x, PAD.y, 0]) - 60 : p.key, p.svg);
for (const f of fence()) put(f.key, f.svg);
const ws = weatherStation();
put(ws.key, ws.svg);
for (const [x, y] of [[FENCE.x + FENCE.w - 6, FENCE.y + 6], [FENCE.x + 6, FENCE.y + 6]]) {
  const c = cctv(x, y);
  put(c.key, c.svg);
}

// trees around the plot (outside the fence)
const TREES = [
  ["b", -88, -80, 13, 1], ["p", -60, -86, 9], ["b", -20, -78, 15, 2], ["p", 20, -84, 10], ["b", 62, -76, 12, 3], ["b", 110, -82, 16, 4],
  ["p", 150, -86, 9], ["b", 196, -78, 13, 5], ["p", 238, -84, 10], ["b", 282, -80, 15, 6], ["b", 330, -76, 12, 7], ["p", 372, -86, 11],
  ["b", 420, -80, 14, 8], ["p", 466, -84, 9], ["b", 500, -72, 12, 9],
  ["b", -86, -30, 12, 10], ["p", -94, 20, 10], ["b", -84, 70, 14, 11], ["p", -96, 118, 9], ["b", -86, 170, 13, 12], ["b", -90, 226, 11, 13], ["p", -94, 276, 10],
  ["b", -80, 312, 9, 14],
  ["b", 498, 10, 12, 15], ["p", 504, 60, 9], ["b", 500, 236, 11, 16],
  ["b", 494, 296, 9, 17],
  ["p", -72, 362, 7], ["b", 30, 366, 8, 18], ["b", 505, 362, 7, 19],
];
for (const t of TREES) {
  const tree = t[0] === "b" ? broadleaf(t[1], t[2], t[3], t[4]) : pine(t[1], t[2], t[3]);
  put(tree.key, tree.svg);
}

items.sort((a, b) => a.key - b.key);

// dust speckle pattern (screen-space) used by every table
const specks = [];
for (let i = 0; i < 90; i++) {
  const x = fmt(rand() * 36);
  const y = fmt(rand() * 36);
  const r = fmt(0.25 + rand() * 0.9);
  const tone = rand() < 0.5 ? "a" : "b";
  specks.push(`<circle cx="${x}" cy="${y}" r="${r}" class="speck-${tone}"/>`);
}
const defs = `<defs>
<pattern id="dust-speckle" patternUnits="userSpaceOnUse" width="36" height="36">${specks.join("")}</pattern>
<linearGradient id="dust-grade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--dust-tint)" stop-opacity=".55"/><stop offset=".7" stop-color="var(--dust-tint)" stop-opacity=".85"/><stop offset="1" stop-color="var(--dust-deep)" stop-opacity="1"/></linearGradient>
</defs>`;

const zoomAbout = (f) => { const [ox, oy] = at([0, 0, 0]); return `translate(${fmt(ox)} ${fmt(oy)}) scale(${f}) translate(${fmt(-ox)} ${fmt(-oy)})`; };
const body = [
  defs,
  `<g class="ground">${groundBlock()}${grassTexture()}${roadAndGravel()}</g>`,
  `<g class="scene">${items.map((i) => i.svg).join("\n")}</g>`,
  `<g class="drone-layer"><g data-part="drone-shadow"><path class="drone-shadow" transform="${zoomAbout(3.2)}" d="${k.haloOf({ x: -7, y: -7, w: 14, d: 14, r: 7 }, 0, 0.1, P)}"/></g><path class="drone-beam" d=""/><g class="drone" data-part="drone"><g transform="${zoomAbout(3.2)}">${drone()}</g></g></g>`,
].join("\n");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "Isometric view of a solar farm: sixteen fixed-tilt tables of PV modules in four rows inside a fenced field, with an inverter station, a weather mast and trees around the plot. A survey drone flies over the arrays.",
  body,
  className: "farm-svg",
});

const tableMeta = tables.map(({ id, row, col, centre, screen }) => ({ id, row, col, centre: centre.map(fmt), screen: screen.map(fmt) }));

const ts = `// Generated by scripts/build-farm.mjs. Do not edit by hand.
/* eslint-disable */
export const FARM_PROJECTION = ${JSON.stringify(P)} as const;
export const FARM_SIZE = { width: ${WIDTH}, height: ${HEIGHT} } as const;
export const DRONE_ALTITUDE = 62;
export const DRONE_HOME = [${PAD.x + 20}, ${PAD.y + 46}, 30] as [number, number, number];
export const FARM_TABLES = ${JSON.stringify(tableMeta)} as const;
export const FARM_SVG = ${JSON.stringify(svg)};
`;
writeFileSync(OUT, ts);
console.log(`wrote ${OUT} (${(ts.length / 1024).toFixed(0)} KB, ${items.length} items, ${tables.length} tables)`);
