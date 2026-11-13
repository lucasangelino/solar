import { FARM_PROJECTION } from "@/generated/farm";

// Same camera as scripts/iso/iso-kit.mjs → iso()
const UNIT = Math.sqrt(1.6);
const RAD = Math.PI / 180;
const a = FARM_PROJECTION.azimuth * RAD;
const e = FARM_PROJECTION.elevation * RAD;
const k = FARM_PROJECTION.scale * UNIT;
const [ox, oy] = FARM_PROJECTION.origin;

export type P3 = [number, number, number];

export function iso([x, y, z]: P3): [number, number] {
  return [ox + (x * Math.sin(a) - y * Math.cos(a)) * k, oy + ((x * Math.cos(a) + y * Math.sin(a)) * Math.sin(e) - z * Math.cos(e)) * k];
}

/** Screen offset that moves something built at the world origin to `p`. */
export function offsetOf(p: P3): [number, number] {
  const [x, y] = iso(p);
  return [x - ox, y - oy];
}

export const pathOf = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
