"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DRONE_ALTITUDE, DRONE_HOME, FARM_TABLES } from "@/generated/farm";
import { CameraCapture } from "@/components/CameraCapture";
import { OutputChart } from "@/components/OutputChart";
import { recommendationFor } from "@/lib/dust";
import { detectDust, type DetectionOutcome } from "@/lib/detectors";
import {
  CLEAN_THRESHOLD, FLIGHT_LOG, PLANT, SEVERITY_STYLE, WEATHER, actualKw, dustOpacity, expectedKw, initialTables,
  lossFraction, severityOf, type Severity, type TableState,
} from "@/lib/mock";
import { iso, offsetOf, pathOf, type P3 } from "@/lib/projection";

type Result = {
  tableId: string;
  photo: string;
  m: DetectionOutcome;
  dust: number;
  before: number;
};

type Phase = "idle" | "camera" | "flying" | "result";

const FLY_OUT_MS = 2600;
const MIN_SCAN_MS = 1600;

export function Dashboard({ farm }: { farm: ReactNode }) {
  const [tables, setTables] = useState<TableState[]>(initialTables);
  const [selected, setSelected] = useState<string>("C2");
  const [mode, setMode] = useState<"photo" | "heat">("photo");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const drone = useRef({ pos: [...DRONE_HOME] as P3, raf: 0 });

  const byId = useMemo(() => Object.fromEntries(tables.map((t) => [t.id, t])), [tables]);
  const sel = byId[selected];
  const totals = useMemo(() => {
    const exp = expectedKw() * tables.length;
    const act = tables.reduce((s, t) => s + actualKw(t.dust), 0);
    const avg = tables.reduce((s, t) => s + t.dust, 0) / tables.length;
    const dirty = tables.filter((t) => t.dust >= CLEAN_THRESHOLD).length;
    return { exp, act, avg, dirty, lossPct: (1 - act / exp) * 100 };
  }, [tables]);
  // scale block loss to the plant: lost MWh/day ≈ capacity × 5.6 peak sun hours × loss
  const plantLossMWhDay = PLANT.capacityMWp * 5.6 * (totals.lossPct / 100);
  const plantLossUsdDay = plantLossMWhDay * PLANT.tariffUsdPerMWh;

  // ---- sync table state into the SVG (no React re-render of the 2 MB figure)
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    for (const t of tables) {
      const g = root.querySelector<SVGGElement>(`[data-table="${t.id}"]`);
      if (!g) continue;
      g.style.setProperty("--dust", String(dustOpacity(t.dust)));
      g.style.setProperty("--heat", SEVERITY_STYLE[severityOf(t.dust)].heat);
      g.toggleAttribute("data-selected", t.id === selected);
    }
  }, [tables, selected]);

  useEffect(() => {
    host.current?.querySelector(".farm")?.setAttribute("data-mode", mode);
  }, [mode]);

  // click / keyboard selection on the figure (event delegation)
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const pickFrom = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-table]")?.getAttribute("data-table");
    const onClick = (e: MouseEvent) => { const id = pickFrom(e.target); if (id) setSelected(id); };
    const onKey = (e: KeyboardEvent) => { const id = pickFrom(e.target); if (id && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelected(id); } };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return () => { root.removeEventListener("click", onClick); root.removeEventListener("keydown", onKey); };
  }, []);

  // ---- drone placement + flight
  const placeDrone = useCallback((p: P3, beamTo?: string | null) => {
    const root = host.current;
    if (!root) return;
    drone.current.pos = p;
    const [dx, dy] = offsetOf(p);
    root.querySelector('[data-part="drone"]')?.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
    const [sx, sy] = offsetOf([p[0], p[1], 0]);
    root.querySelector('[data-part="drone-shadow"]')?.setAttribute("transform", `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    const beam = root.querySelector(".drone-beam");
    const t = beamTo ? FARM_TABLES.find((x) => x.id === beamTo) : null;
    if (beam && t) {
      const [cx, cy, cz] = t.centre;
      const foot = [[-30, -14], [30, -14], [30, 14], [-30, 14]].map(([ax, ay]) => iso([cx + ax, cy + ay * 0.9, cz - ay * 0.42] as P3));
      const cam = iso([p[0], p[1] + 3.2 * 3.2, p[2] - 2.2 * 3.2]); // gimbal (drone is drawn 3.2× scale)
      beam.setAttribute("d", pathOf(hullFan(cam, foot)));
    }
  }, []);

  const fly = useCallback((to: P3, ms: number, beamTo?: string | null) => new Promise<void>((resolve) => {
    cancelAnimationFrame(drone.current.raf);
    const from = [...drone.current.pos] as P3;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const step = (now: number) => {
      const u = still ? 1 : Math.min(1, (now - start) / ms);
      const s = u * u * (3 - 2 * u);
      const lift = Math.sin(Math.PI * u) * 10; // arc
      placeDrone([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, from[2] + (to[2] - from[2]) * s + lift], beamTo);
      if (u < 1) drone.current.raf = requestAnimationFrame(step);
      else resolve();
    };
    drone.current.raf = requestAnimationFrame(step);
  }), [placeDrone]);

  useEffect(() => placeDrone([...DRONE_HOME] as P3), [placeDrone]);

  const farmEl = () => host.current?.querySelector(".farm");

  const runInspection = useCallback(async (photo: string) => {
    const target = selected;
    const meta = FARM_TABLES.find((t) => t.id === target)!;
    const before = byId[target].dust;
    setPhase("flying");
    setResult(null);
    const fe = farmEl();
    fe?.setAttribute("data-flying", "");
    setStatus(`Drone SV-02 en route to table ${target}`);

    // analysis runs while the drone flies
    const analysis = detectDust(photo);

    const over: P3 = [meta.centre[0], meta.centre[1] + 6, DRONE_ALTITUDE];
    await fly([DRONE_HOME[0], DRONE_HOME[1], DRONE_ALTITUDE - 10], 700);
    await fly(over, FLY_OUT_MS);
    host.current?.querySelector(`[data-table="${target}"]`)?.setAttribute("data-scanning", "");
    fe?.setAttribute("data-beam", "");
    setStatus(`Capturing and analysing table ${target}…`);
    placeDrone(over, target);
    const [m] = await Promise.all([analysis, new Promise((r) => setTimeout(r, MIN_SCAN_MS))]);
    const dust = Math.max(0, Math.min(100, m.coveragePercent));
    setTables((list) => list.map((t) => (t.id === target ? { ...t, dust, lastInspected: "just now", live: true } : t)));
    setResult({ tableId: target, photo, m, dust, before });
    setPhase("result");
    setStatus("");
    host.current?.querySelector(`[data-table="${target}"]`)?.removeAttribute("data-scanning");
    fe?.removeAttribute("data-beam");
    // fly home in the background
    fly([DRONE_HOME[0], DRONE_HOME[1], DRONE_ALTITUDE - 10], FLY_OUT_MS).then(() => fly([...DRONE_HOME] as P3, 700)).then(() => farmEl()?.removeAttribute("data-flying"));
  }, [selected, byId, fly, placeDrone]);

  const sev = sel ? severityOf(sel.dust) : "clean";

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#eef1ea] text-stone-800 lg:flex-row">
      {/* ---------------- main ---------------- */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stone-200/80 bg-white/70 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <p className="text-sm font-semibold leading-tight text-stone-900">SolarScan</p>
              <p className="text-[11px] leading-tight text-stone-500">Drone soiling analytics</p>
            </div>
          </div>
          <div className="h-8 w-px bg-stone-200" />
          <div>
            <p className="text-sm font-medium leading-tight">{PLANT.name}</p>
            <p className="text-[11px] leading-tight text-stone-500">{PLANT.block} · {PLANT.location} · {PLANT.capacityMWp} MWp</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
            <Chip label="POA irradiance" value={`${WEATHER.irradiance} W/m²`} />
            <Chip label="Module" value={`${WEATHER.moduleC} °C`} />
            <Chip label="Wind" value={`${WEATHER.windMs} m/s`} />
            <Chip label="PM10" value={`${WEATHER.pm10} µg/m³`} warn />
            <Chip label="Last rain" value={`${WEATHER.lastRainDays} d`} />
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-auto">
          <div className="absolute left-5 top-4 z-10 flex items-center gap-1 rounded-lg border border-stone-200 bg-white/90 p-1 text-xs shadow-sm backdrop-blur">
            {(["photo", "heat"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 font-medium ${mode === m ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                {m === "photo" ? "Visual" : "Soiling heatmap"}
              </button>
            ))}
          </div>
          <div className="absolute bottom-4 left-5 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white/90 px-3 py-2 text-[11px] text-stone-600 shadow-sm backdrop-blur">
            {(Object.keys(SEVERITY_STYLE) as Severity[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${SEVERITY_STYLE[s].dot}`} />{SEVERITY_STYLE[s].label}</span>
            ))}
            <span className="text-stone-400">· click a table to select it</span>
          </div>
          {status && (
            <div className="absolute right-5 top-4 z-10 flex items-center gap-2 rounded-full bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />{status}
            </div>
          )}
          <div ref={host} className="mx-auto w-full max-w-[1400px] px-2 pb-10 pt-12">
            {farm}
          </div>
        </div>
      </main>

      {/* ---------------- sidebar ---------------- */}
      <aside className="flex max-h-[60dvh] w-full shrink-0 flex-col border-t border-stone-200 bg-white lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section>
            <SectionTitle>Block overview</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Output now" value={`${totals.act.toFixed(1)} kW`} sub={`of ${totals.exp.toFixed(1)} kW clean`} />
              <Stat label="Soiling loss" value={`${totals.lossPct.toFixed(1)} %`} sub="vs clean modules" tone={totals.lossPct > 8 ? "bad" : "warn"} />
              <Stat label="Avg. coverage" value={`${totals.avg.toFixed(1)} %`} sub={`${tables.length} tables · ${tables.length * PLANT.modulesPerTable} modules`} />
              <Stat label="Need cleaning" value={`${totals.dirty} / ${tables.length}`} sub={`≥ ${CLEAN_THRESHOLD}% coverage`} tone={totals.dirty ? "warn" : undefined} />
            </div>
            <div className="mt-2.5 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>Plant-wide projected loss</span>
              <span className="font-semibold tabular-nums">{plantLossMWhDay.toFixed(1)} MWh · ${plantLossUsdDay.toFixed(0)}/day</span>
            </div>
          </section>

          <section>
            <SectionTitle>Block output today</SectionTitle>
            <OutputChart avgDust={totals.avg} />
          </section>

          {sel && (
            <section>
              <SectionTitle>Selected table</SectionTitle>
              <div className="rounded-xl border border-stone-200 p-3.5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold leading-tight">Table {sel.id}</p>
                    <p className="text-[11px] text-stone-500">Row {"ABCD"[sel.row]} · {PLANT.modulesPerTable} × {PLANT.moduleWp} Wp · inspected {sel.lastInspected}</p>
                  </div>
                  <span className={`flex items-center gap-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[sev].text}`}>
                    <span className={`h-2 w-2 rounded-full ${SEVERITY_STYLE[sev].dot}`} />{SEVERITY_STYLE[sev].label}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100" role="meter" aria-valuemin={0} aria-valuemax={50} aria-valuenow={sel.dust} aria-label="Dust coverage">
                  <div className={`h-full rounded-full ${SEVERITY_STYLE[sev].dot} transition-all duration-700`} style={{ width: `${Math.min(100, sel.dust * 2)}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Dust" value={`${sel.dust.toFixed(1)}%`} />
                  <Mini label="Output" value={`${actualKw(sel.dust).toFixed(2)} kW`} />
                  <Mini label="Loss" value={`${(lossFraction(sel.dust) * 100).toFixed(1)}%`} />
                </div>
                {sel.live && <p className="mt-2 text-[11px] font-medium text-sky-700">● Measured live by drone</p>}
              </div>
            </section>
          )}

          <section>
            <SectionTitle>Dirtiest tables</SectionTitle>
            <ul className="space-y-1">
              {[...tables].sort((a, b) => b.dust - a.dust).slice(0, 5).map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-50 ${t.id === selected ? "bg-stone-100" : ""}`}>
                    <span className={`h-2 w-2 rounded-full ${SEVERITY_STYLE[severityOf(t.dust)].dot}`} />
                    <span className="w-8 font-medium">{t.id}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full bg-stone-400" style={{ width: `${Math.min(100, t.dust * 3)}%` }} /></span>
                    <span className="w-12 text-right tabular-nums text-stone-600">{t.dust.toFixed(1)}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Recent flights</SectionTitle>
            <ul className="divide-y divide-stone-100 text-xs">
              {FLIGHT_LOG.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-1.5">
                  <span><span className="font-medium text-stone-700">{f.id}</span> <span className="text-stone-400">· {f.when}</span></span>
                  <span className="tabular-nums text-stone-600">avg {f.avgDust}%</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="border-t border-stone-200 bg-stone-50/80 p-4">
          <button
            onClick={() => setPhase("camera")}
            disabled={phase === "flying" || phase === "camera"}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-sky-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-sky-600/20 transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            <DroneIcon />
            {phase === "flying" ? "Drone in flight…" : `Simulate drone flight · table ${selected}`}
          </button>
          <p className="mt-2 text-center text-[11px] text-stone-500">Takes a photo, measures the dust and updates the table.</p>
        </div>
      </aside>

      {phase === "camera" && (
        <CameraCapture tableId={selected} onCancel={() => setPhase("idle")} onCapture={(shot) => runInspection(shot)} />
      )}
      {phase === "result" && result && (
        <ResultModal result={result} showOverlay={showOverlay} setShowOverlay={setShowOverlay} onClose={() => setPhase("idle")} />
      )}
    </div>
  );
}

// fan from the camera to the footprint: hull of the 5 points
function hullFan(cam: [number, number], foot: [number, number][]) {
  const pts = [cam, ...foot].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function ResultModal({ result, showOverlay, setShowOverlay, onClose }: { result: Result; showOverlay: boolean; setShowOverlay: (v: boolean) => void; onClose: () => void }) {
  const sev = severityOf(result.dust);
  const kwBefore = actualKw(result.before);
  const kwNow = actualKw(result.dust);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Inspection result">
      <div className="grid max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl md:grid-cols-[1.15fr_1fr]">
        <div className="relative bg-stone-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={showOverlay && result.m.overlay ? result.m.overlay : result.photo} alt={showOverlay && result.m.overlay ? "Photo with detected dust highlighted in orange" : "Drone photo"} className="h-full max-h-[70dvh] w-full object-contain" />
          {result.m.overlay && <div className="absolute left-3 top-3 flex gap-1 rounded-lg bg-black/50 p-1 text-[11px] text-white">
            <button onClick={() => setShowOverlay(true)} className={`rounded px-2 py-0.5 ${showOverlay ? "bg-white/25" : ""}`}>Detected dust</button>
            <button onClick={() => setShowOverlay(false)} className={`rounded px-2 py-0.5 ${!showOverlay ? "bg-white/25" : ""}`}>Original</button>
          </div>}
        </div>
        <div className="flex flex-col p-6">
          <p className="text-[11px] font-medium uppercase tracking-wider text-sky-700">Inspection complete · table {result.tableId}</p>
          <div className="mt-2 flex items-end gap-3">
            <p className="text-5xl font-semibold tabular-nums tracking-tight text-stone-900">{result.dust.toFixed(1)}<span className="text-2xl text-stone-400">%</span></p>
            <span className={`mb-2 flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[sev].text}`}>
              <span className={`h-2 w-2 rounded-full ${SEVERITY_STYLE[sev].dot}`} />{SEVERITY_STYLE[sev].label}
            </span>
          </div>
          <p className="text-xs text-stone-500">of the surface covered by dust · {result.m.detector.name}</p>

          {result.m.details.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              {result.m.details.map((d) => (
                <div key={d.label} className="rounded-lg bg-stone-50 p-2.5">
                  <p className="text-[11px] text-stone-500">{d.label}</p>
                  <p className="font-semibold tabular-nums">{d.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm">
            {result.m.pattern && <p><span className="text-stone-500">Pattern: </span>{result.m.pattern}</p>}
            <p><span className="text-stone-500">Recommendation: </span>{recommendationFor(result.dust)}</p>
            {result.m.fallbackReason && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">The model failed ({result.m.fallbackReason}), so the on-device calculation was used.</p>}
            {result.m.warnings.map((w) => <p key={w} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">{w}</p>)}
          </div>

          <div className="mt-4 rounded-lg border border-stone-200 p-3 text-sm">
            <div className="flex justify-between"><span className="text-stone-500">Table output</span><span className="tabular-nums">{kwBefore.toFixed(2)} → <b>{kwNow.toFixed(2)} kW</b></span></div>
            <div className="mt-1 flex justify-between"><span className="text-stone-500">Soiling loss</span><span className="tabular-nums">{(lossFraction(result.dust) * 100).toFixed(1)}%</span></div>
            <div className="mt-1 flex justify-between"><span className="text-stone-500">Work order</span><span className={result.dust >= CLEAN_THRESHOLD ? "font-medium text-orange-700" : "text-emerald-700"}>{result.dust >= CLEAN_THRESHOLD ? "Cleaning scheduled" : "Not needed"}</span></div>
          </div>
          <button onClick={onClose} className="mt-auto w-full rounded-lg bg-stone-900 py-2.5 text-sm font-semibold text-white hover:bg-stone-800 md:mt-5">Back to the farm</button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{children}</h3>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums tracking-tight ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-stone-900"}`}>{value}</p>
      <p className="text-[10px] text-stone-400">{sub}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-50 py-1.5">
      <p className="text-[10px] text-stone-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 ${warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-stone-200 bg-white text-stone-600"}`}>
      <span className="text-stone-400">{label} </span><span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
      <rect width="30" height="30" rx="8" fill="#0c4a6e" />
      <path d="M7 19l5-9h11l-5 9z" fill="#38bdf8" />
      <path d="M12 10l-5 9M17.5 10l-5 9M9.5 14.5h11" stroke="#0c4a6e" strokeWidth="1.2" />
      <circle cx="22" cy="8" r="2.4" fill="#fbbf24" />
    </svg>
  );
}

function DroneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
      <path d="M9 9L6 6M15 9l3-3M9 15l-3 3M15 15l3 3" />
      <circle cx="5" cy="5" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" />
    </svg>
  );
}
