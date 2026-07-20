"use client";

import { useRef, useState } from "react";
import type { SimPoint } from "@/lib/bess";
import { PEAK_END_HOUR, PEAK_START_HOUR } from "@/lib/config";
import { niceMax } from "@/components/charts";

const L = { w: 860, h: 300, l: 46, r: 16, t: 26, b: 30 };
const plotW = L.w - L.l - L.r;
const plotH = L.h - L.t - L.b;

function hourOf(p: SimPoint): number {
  return p.hour + p.minute / 60;
}

/** Line chart: raw load (before) vs grid draw (after battery), one day. */
export function LoadVsShavedChart({ day }: { day: SimPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number; top: number } | null>(null);

  const yMax = niceMax(day.reduce((m, p) => Math.max(m, p.kw, p.gridKw), 0), 10);
  const yMin = Math.min(0, day.reduce((m, p) => Math.min(m, p.kw, p.gridKw), 0));
  const lx = (h: number) => L.l + (h / 24) * plotW;
  const ly = (v: number) => L.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const before = day.map((p) => `${p === day[0] ? "M" : "L"}${lx(hourOf(p)).toFixed(1)} ${ly(p.kw).toFixed(1)}`).join(" ");
  const after = day.map((p) => `${p === day[0] ? "M" : "L"}${lx(hourOf(p)).toFixed(1)} ${ly(p.gridKw).toFixed(1)}`).join(" ");

  const bx = lx(PEAK_START_HOUR);
  const bw = lx(PEAK_END_HOUR) - bx;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  function onMove(evt: React.MouseEvent<SVGSVGElement>) {
    if (!day.length || !wrapRef.current) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * L.w;
    const h = ((mx - L.l) / plotW) * 24;
    let best = 0;
    for (let i = 1; i < day.length; i++) {
      if (Math.abs(hourOf(day[i]) - h) < Math.abs(hourOf(day[best]) - h)) best = i;
    }
    const wrapW = wrapRef.current.clientWidth;
    const px = (lx(hourOf(day[best])) / L.w) * wrapW;
    let left = px + 14;
    if (left + 165 > wrapW) left = px - 165;
    setHover({ i: best, left, top: 20 });
  }

  const h = hover ? day[hover.i] : null;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${L.w} ${L.h}`} role="img" aria-label="Load before and after battery, one day" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <rect x={bx} y={L.t} width={bw} height={plotH} fill="var(--warn-wash)" />
        <text x={bx + 8} y={L.t + 14} fontSize={11} fill="var(--warn-text)" fontWeight={600}>PEAK</text>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L.l} y1={ly(v)} x2={L.l + plotW} y2={ly(v)} stroke={Math.abs(v) < 0.01 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L.l - 8} y={ly(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(v)}</text>
          </g>
        ))}
        {[0, 4, 8, 12, 16, 20, 24].map((hh) => (
          <text key={hh} x={lx(hh)} y={L.t + plotH + 20} fontSize={11} textAnchor="middle" fill="var(--muted)">{String(hh).padStart(2, "0")}:00</text>
        ))}
        {day.length > 1 && (
          <>
            <path d={before} fill="none" stroke="var(--muted)" strokeWidth={1.75} strokeDasharray="4 3" strokeLinejoin="round" />
            <path d={after} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" />
          </>
        )}
        {h && <line x1={lx(hourOf(h))} y1={L.t} x2={lx(hourOf(h))} y2={L.t + plotH} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />}
      </svg>
      <div className={`tooltip${h ? " on" : ""}`} style={hover ? { left: hover.left, top: hover.top } : undefined}>
        {h && (
          <>
            <div className="t-title">{String(h.hour).padStart(2, "0")}:{String(h.minute).padStart(2, "0")}</div>
            <div className="t-row"><span><span className="tt-swatch" style={{ background: "var(--muted)" }} />Without battery</span><b>{h.kw.toFixed(0)} kW</b></div>
            <div className="t-row"><span><span className="tt-swatch" style={{ background: "var(--accent)" }} />With battery</span><b>{h.gridKw.toFixed(0)} kW</b></div>
          </>
        )}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--muted)" }} />Without battery</span>
        <span><i style={{ background: "var(--accent)" }} />With battery</span>
      </div>
    </div>
  );
}

/** Area chart: battery state of charge (%) across one day. */
export function SocChart({ day, capacityKwh }: { day: SimPoint[]; capacityKwh: number }) {
  const lx = (h: number) => L.l + (h / 24) * plotW;
  const ly = (pct: number) => L.t + (1 - pct / 100) * plotH;

  const pts = day.map((p) => ({ h: hourOf(p), pct: capacityKwh > 0 ? (p.socKwh / capacityKwh) * 100 : 0 }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${lx(p.h).toFixed(1)} ${ly(p.pct).toFixed(1)}`).join(" ");
  const area = pts.length > 1 ? `${line} L${lx(pts[pts.length - 1].h).toFixed(1)} ${ly(0)} L${lx(pts[0].h).toFixed(1)} ${ly(0)} Z` : "";

  const bx = lx(PEAK_START_HOUR);
  const bw = lx(PEAK_END_HOUR) - bx;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${L.w} ${L.h}`} role="img" aria-label="Battery state of charge across one day">
        <rect x={bx} y={L.t} width={bw} height={plotH} fill="var(--warn-wash)" />
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={L.l} y1={ly(v)} x2={L.l + plotW} y2={ly(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L.l - 8} y={ly(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        {[0, 4, 8, 12, 16, 20, 24].map((hh) => (
          <text key={hh} x={lx(hh)} y={L.t + plotH + 20} fontSize={11} textAnchor="middle" fill="var(--muted)">{String(hh).padStart(2, "0")}:00</text>
        ))}
        {pts.length > 1 && (
          <>
            <path d={area} fill="var(--accent-soft)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
      </svg>
    </div>
  );
}
