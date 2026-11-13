// Mock plant data. Everything here is invented for the demo; the live drone flight
// replaces one table's soiling value with a real measurement.
import { FARM_TABLES } from "@/generated/farm";

export const PLANT = {
  name: "Valle Sol PV Plant",
  block: "Block B-07",
  location: "San Juan, AR",
  capacityMWp: 12.4,
  modulesPerTable: 16,
  moduleWp: 550,
  tariffUsdPerMWh: 62,
};

export const WEATHER = {
  irradiance: 842, // W/m² plane of array
  ambientC: 31,
  moduleC: 52,
  windMs: 4.2,
  pm10: 118, // µg/m³ (dusty day)
  lastRainDays: 23,
};

export type TableState = {
  id: string;
  row: number;
  col: number;
  dust: number; // % surface covered
  lastInspected: string;
  live?: boolean; // measured by the live demo
};

// deterministic pseudo-random soiling: more dust on the windward (west, col 1) side and front rows
const SEED_DUST: Record<string, number> = {
  A1: 9.4, A2: 4.1, A3: 2.6, A4: 6.8,
  B1: 14.2, B2: 7.5, B3: 3.1, B4: 11.9,
  C1: 18.6, C2: 5.2, C3: 8.8, C4: 2.2,
  D1: 23.4, D2: 12.7, D3: 4.4, D4: 16.1,
};

export function initialTables(): TableState[] {
  return FARM_TABLES.map((t) => ({
    id: t.id,
    row: t.row,
    col: t.col,
    dust: SEED_DUST[t.id] ?? 5,
    lastInspected: `${3 + ((t.row * 4 + t.col) % 6)} days ago`,
  }));
}

export const TABLE_KWP = (PLANT.modulesPerTable * PLANT.moduleWp) / 1000; // 8.8 kWp

/** Soiling → fraction of power lost. Roughly proportional to blocked area. */
export const lossFraction = (dust: number) => Math.min(0.95, (dust / 100) * 0.92);

/** Expected (clean) output of one table right now, kW. */
export const expectedKw = () => TABLE_KWP * (WEATHER.irradiance / 1000) * (1 - 0.004 * (WEATHER.moduleC - 25)) * 0.97;

export const actualKw = (dust: number) => expectedKw() * (1 - lossFraction(dust));

export type Severity = "clean" | "light" | "moderate" | "heavy" | "severe";
export const severityOf = (dust: number): Severity => (dust < 3 ? "clean" : dust < 8 ? "light" : dust < 15 ? "moderate" : dust < 30 ? "heavy" : "severe");
export const CLEAN_THRESHOLD = 12; // % coverage that triggers a cleaning work order

export const SEVERITY_STYLE: Record<Severity, { label: string; dot: string; text: string; heat: string }> = {
  clean: { label: "Clean", dot: "bg-emerald-500", text: "text-emerald-700", heat: "#2f8a4e" },
  light: { label: "Light", dot: "bg-lime-500", text: "text-lime-700", heat: "#4f7d3a" },
  moderate: { label: "Moderate", dot: "bg-amber-500", text: "text-amber-700", heat: "#a87a1f" },
  heavy: { label: "Heavy", dot: "bg-orange-600", text: "text-orange-700", heat: "#b5531c" },
  severe: { label: "Severe", dot: "bg-red-600", text: "text-red-700", heat: "#a3262a" },
};

/** Visual dust layer opacity for a coverage %. */
export const dustOpacity = (dust: number) => Math.min(1, Math.pow(dust / 35, 0.8));

/** Today's block output curve (kW), 5:30 → 20:00 in 30 min steps, with the clean expectation. */
export function outputCurve(avgDust: number) {
  const points: { t: string; h: number; expected: number; actual: number }[] = [];
  const peak = expectedKw() * 16 * 1.08;
  for (let h = 5.5; h <= 20.01; h += 0.5) {
    const sun = Math.max(0, Math.sin(((h - 5.5) / 14.5) * Math.PI));
    const cloud = h > 13 && h < 14.2 ? 0.86 : 1;
    const expected = peak * Math.pow(sun, 1.25);
    const actual = expected * cloud * (1 - lossFraction(avgDust));
    const hh = Math.floor(h);
    points.push({ t: `${String(hh).padStart(2, "0")}:${h % 1 ? "30" : "00"}`, h, expected, actual });
  }
  return points;
}

export const NOW_HOUR = 13.5;

export const FLIGHT_LOG = [
  { id: "FL-2611", when: "Nov 10, 09:12", tables: 16, avgDust: 7.9, drone: "DJI M350 · SV-02" },
  { id: "FL-2604", when: "Nov 03, 08:47", tables: 16, avgDust: 4.6, drone: "DJI M350 · SV-02" },
  { id: "FL-2597", when: "Oct 27, 09:30", tables: 16, avgDust: 2.1, drone: "DJI M350 · SV-01" },
];
