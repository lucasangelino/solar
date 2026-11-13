"use client";

import { useMemo, useState } from "react";
import { NOW_HOUR, outputCurve } from "@/lib/mock";

const W = 320;
const H = 132;
const PAD = { l: 30, r: 8, t: 10, b: 20 };

/** Today's block output: actual vs clean-panel expectation, with hover crosshair. */
export function OutputChart({ avgDust }: { avgDust: number }) {
  const data = useMemo(() => outputCurve(avgDust).filter((p) => p.h <= NOW_HOUR), [avgDust]);
  const full = useMemo(() => outputCurve(avgDust), [avgDust]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...full.map((p) => p.expected)) * 1.08;
  const x = (h: number) => PAD.l + ((h - 5.5) / 14.5) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = (key: "expected" | "actual", pts = data) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)} ${y(p[key]).toFixed(1)}`).join("");
  const area = line("actual") + `L${x(data[data.length - 1].h)} ${y(0)}L${x(data[0].h)} ${y(0)}Z`;
  const ticks = [0, Math.round(max / 2 / 10) * 10, Math.round((max * 0.9) / 10) * 10];
  const lost = data.reduce((s, p) => s + (p.expected - p.actual) * 0.5, 0);
  const hp = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-4 text-[11px] text-stone-500">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-sky-600" />Actual</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded border-t border-dashed border-stone-400" />Clean expected</span>
        <span className="ml-auto tabular-nums text-stone-600">{lost.toFixed(0)} kWh lost today</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Block output today: ${data[data.length - 1].actual.toFixed(0)} kW now versus ${data[data.length - 1].expected.toFixed(0)} kW expected for clean panels`}
        onPointerMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          const h = 5.5 + (((ev.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * 14.5;
          let best = 0;
          data.forEach((p, i) => { if (Math.abs(p.h - h) < Math.abs(data[best].h - h)) best = i; });
          setHover(h < 5.2 || h > NOW_HOUR + 0.4 ? null : best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e7e5e4" strokeWidth={1} />
            <text x={PAD.l - 5} y={y(t) + 3} textAnchor="end" className="fill-stone-400 text-[9px] tabular-nums">{t}</text>
          </g>
        ))}
        {[6, 9, 12, 15, 18].map((h) => (
          <text key={h} x={x(h)} y={H - 5} textAnchor="middle" className="fill-stone-400 text-[9px]">{String(h).padStart(2, "0")}:00</text>
        ))}
        <path d={line("expected", full)} fill="none" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="3 3" />
        <path d={area} fill="#0284c7" fillOpacity={0.1} />
        <path d={line("actual")} fill="none" stroke="#0284c7" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(data[data.length - 1].h)} cy={y(data[data.length - 1].actual)} r={4} fill="#0284c7" stroke="white" strokeWidth={2} />
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.h)} x2={x(hp.h)} y1={PAD.t} y2={H - PAD.b} stroke="#78716c" strokeWidth={1} />
            <circle cx={x(hp.h)} cy={y(hp.actual)} r={4} fill="#0284c7" stroke="white" strokeWidth={2} />
            <g transform={`translate(${Math.min(x(hp.h) + 6, W - 112)} ${PAD.t})`}>
              <rect width={104} height={40} rx={6} fill="white" stroke="#e7e5e4" />
              <text x={8} y={14} className="fill-stone-500 text-[9px]">{hp.t}</text>
              <text x={8} y={26} className="fill-stone-800 text-[10px] tabular-nums">Actual {hp.actual.toFixed(0)} kW</text>
              <text x={8} y={36} className="fill-stone-500 text-[9px] tabular-nums">Expected {hp.expected.toFixed(0)} kW</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
