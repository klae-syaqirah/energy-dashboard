"use client";

import { useRef, useState } from "react";
import type { SummaryBucket } from "@/app/api/summary/route";

const KL_OFFSET_MS = 8 * 3600 * 1000;

/** KL local decimal hour (0–24) of a UTC epoch in seconds. */
export function klHour(epochSec: number): number {
  return ((epochSec * 1000 + KL_OFFSET_MS) % 86400000) / 3600000;
}

export function fmtTimeKL(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  });
}

/** Smallest "nice" axis maximum that fits v. */
export function niceMax(v: number, floor = 10): number {
  const candidates = [10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000];
  const target = Math.max(v * 1.1, floor);
  for (const c of candidates) if (c >= target) return c;
  return Math.ceil(target / 1000) * 1000;
}

/* =====================  Gauge  ===================== */

export function Gauge({ value, max }: { value: number; max: number }) {
  const cx = 110, cy = 104, r = 84, sw = 13;
  const pt = (f: number, rad = r) => {
    const a = Math.PI * (1 - f);
    return { x: cx + rad * Math.cos(a), y: cy - rad * Math.sin(a) };
  };
  const f = Math.min(1, Math.max(0, value / max));
  const s0 = pt(0), s1 = pt(f), sEnd = pt(1);
  const arc = (to: { x: number; y: number }) =>
    `M${s0.x.toFixed(1)} ${s0.y.toFixed(1)} A${r} ${r} 0 0 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;

  return (
    <div className="gauge">
      <svg viewBox="0 0 220 124" role="img" aria-label={`Gauge: total active power ${value.toFixed(1)} of ${max} kilowatts`}>
        <path d={arc(sEnd)} fill="none" stroke="var(--grid)" strokeWidth={sw} strokeLinecap="round" />
        {f > 0.005 && (
          <path d={arc(s1)} fill="none" stroke="var(--accent)" strokeWidth={sw} strokeLinecap="round" />
        )}
        <circle cx={s1.x} cy={s1.y} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
        {[0.25, 0.5, 0.75].map((ff) => {
          const p1 = pt(ff, r - sw / 2 - 4);
          const p2 = pt(ff, r - sw / 2 - 10);
          return <line key={ff} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--axis)" strokeWidth={1.5} />;
        })}
        <text x={s0.x} y={cy + 16} fontSize={11} textAnchor="middle" fill="var(--muted)">0</text>
        <text x={sEnd.x} y={cy + 16} fontSize={11} textAnchor="middle" fill="var(--muted)">{max}</text>
        <text x={cx} y={cy - 12} fontSize={34} fontWeight={650} textAnchor="middle" fill="var(--ink)">
          {value.toFixed(1)}
        </text>
        <text x={cx} y={cy + 8} fontSize={13} fontWeight={550} textAnchor="middle" fill="var(--ink-2)">kW</text>
      </svg>
    </div>
  );
}

/* =====================  Load curve (today)  ===================== */

const L = { w: 860, h: 300, l: 46, r: 16, t: 26, b: 30 };
const plotW = L.w - L.l - L.r;
const plotH = L.h - L.t - L.b;

export function LoadChart({
  series,
  peakStartHour,
  peakEndHour,
}: {
  series: SummaryBucket[];
  peakStartHour: number;
  peakEndHour: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number; top: number } | null>(null);

  const yMax = niceMax(series.reduce((m, b) => Math.max(m, b.kw), 0));
  const lx = (h: number) => L.l + (h / 24) * plotW;
  const ly = (v: number) => L.t + (1 - v / yMax) * plotH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  const pts = series.map((b) => ({ h: klHour(b.e), ...b }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${lx(p.h).toFixed(1)} ${ly(p.kw).toFixed(1)}`).join(" ");
  const area = pts.length > 1
    ? `${line} L${lx(pts[pts.length - 1].h).toFixed(1)} ${ly(0)} L${lx(pts[0].h).toFixed(1)} ${ly(0)} Z`
    : "";
  const last = pts[pts.length - 1];
  const bx = lx(peakStartHour);
  const bw = lx(peakEndHour) - bx;

  function onMove(evt: React.MouseEvent<SVGSVGElement>) {
    if (!pts.length || !wrapRef.current) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * L.w;
    const h = ((mx - L.l) / plotW) * 24;
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].h - h) < Math.abs(pts[best].h - h)) best = i;
    }
    const wrapW = wrapRef.current.clientWidth;
    const wrapH = wrapRef.current.clientHeight;
    const px = (lx(pts[best].h) / L.w) * wrapW;
    const py = (ly(pts[best].kw) / L.h) * wrapH;
    let left = px + 14;
    if (left + 160 > wrapW) left = px - 160;
    setHover({ i: best, left, top: Math.max(0, py - 54) });
  }

  const hovered = hover ? pts[hover.i] : null;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${L.w} ${L.h}`}
        role="img"
        aria-label="Line chart of total factory load today in kilowatts"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <rect x={bx} y={L.t} width={bw} height={plotH} fill="var(--warn-wash)" />
        {[bx, bx + bw].map((x) => (
          <line key={x} x1={x} y1={L.t} x2={x} y2={L.t + plotH} stroke="var(--status-warn)" strokeWidth={1} strokeDasharray="3 4" opacity={0.55} />
        ))}
        <text x={bx + 8} y={L.t + 14} fontSize={11} fill="var(--warn-text)" fontWeight={600}>PEAK</text>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L.l} y1={ly(v)} x2={L.l + plotW} y2={ly(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L.l - 8} y={ly(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{fmtTick(v)}</text>
          </g>
        ))}
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <text key={h} x={lx(h)} y={L.t + plotH + 20} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {String(h).padStart(2, "0")}:00
          </text>
        ))}

        {pts.length > 1 && (
          <>
            <path d={area} fill="var(--accent-soft)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {last && (
          <>
            <circle cx={lx(last.h)} cy={ly(last.kw)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            <text x={lx(last.h) + 9} y={ly(last.kw) - 8} fontSize={11.5} fontWeight={650} fill="var(--ink)">
              {last.kw.toFixed(1)} kW
            </text>
          </>
        )}

        {hovered && (
          <>
            <line x1={lx(hovered.h)} y1={L.t} x2={lx(hovered.h)} y2={L.t + plotH} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={lx(hovered.h)} cy={ly(hovered.kw)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className={`tooltip${hovered ? " on" : ""}`} style={hover ? { left: hover.left, top: hover.top } : undefined}>
        {hovered && (
          <>
            <div className="t-title">
              {fmtTimeKL(hovered.e)} · {hovered.h >= peakStartHour && hovered.h < peakEndHour ? "peak" : "off-peak"}
            </div>
            <div className="t-row">
              <span><span className="tt-swatch" style={{ background: "var(--accent)" }} />Load</span>
              <b>{hovered.kw.toFixed(1)} kW</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =====================  Weekly stacked bars  ===================== */

const B = { w: 860, h: 280, l: 46, r: 16, t: 22, b: 34 };
const bPlotW = B.w - B.l - B.r;
const bPlotH = B.h - B.t - B.b;

export function WeeklyBars({
  days,
  peakLabel,
}: {
  days: { label: string; peak: number; off: number; today: boolean }[];
  peakLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);

  const bMax = niceMax(days.reduce((m, d) => Math.max(m, d.peak + d.off), 0), 100);
  const by = (v: number) => B.t + (1 - v / bMax) * bPlotH;
  const groupW = bPlotW / days.length;
  const barW = 54;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * bMax);

  function onMove(evt: React.MouseEvent<SVGSVGElement>) {
    if (!wrapRef.current) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * B.w;
    const i = Math.min(days.length - 1, Math.max(0, Math.floor((mx - B.l) / groupW)));
    const wrapW = wrapRef.current.clientWidth;
    const cx = ((B.l + groupW * i + groupW / 2) / B.w) * wrapW;
    let left = cx + 12;
    if (left + 170 > wrapW) left = cx - 182;
    setHover({ i, left });
  }

  const hovered = hover ? days[hover.i] : null;

  return (
    <>
      <div className="chart-wrap" ref={wrapRef}>
        <svg
          viewBox={`0 0 ${B.w} ${B.h}`}
          role="img"
          aria-label="Stacked bar chart of daily energy consumption for the last 7 days, split into peak and off-peak"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={B.l} y1={by(v)} x2={B.l + bPlotW} y2={by(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={B.l - 8} y={by(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(v)}</text>
            </g>
          ))}
          {days.map((day, i) => {
            const cx = B.l + groupW * i + groupW / 2;
            const x0 = cx - barW / 2;
            const total = day.peak + day.off;
            const yPeakTop = by(day.peak);
            const yTop = by(total);
            const segBot = yPeakTop - 2;
            const r = 4;
            return (
              <g key={day.label}>
                {day.peak > 0 && (
                  <rect x={x0} y={yPeakTop} width={barW} height={by(0) - yPeakTop} fill="var(--bar-peak)" />
                )}
                {segBot - yTop > 4 && (
                  <path
                    d={`M${x0} ${segBot.toFixed(1)} L${x0} ${(yTop + r).toFixed(1)} Q${x0} ${yTop.toFixed(1)} ${x0 + r} ${yTop.toFixed(1)} L${x0 + barW - r} ${yTop.toFixed(1)} Q${x0 + barW} ${yTop.toFixed(1)} ${x0 + barW} ${(yTop + r).toFixed(1)} L${x0 + barW} ${segBot.toFixed(1)} Z`}
                    fill="var(--bar-off)"
                  />
                )}
                {day.today && total > 0 && (
                  <text x={cx} y={yTop - 8} fontSize={11.5} fontWeight={650} textAnchor="middle" fill="var(--ink)">
                    {Math.round(total)} kWh
                  </text>
                )}
                <text
                  x={cx}
                  y={B.t + bPlotH + 20}
                  fontSize={11}
                  textAnchor="middle"
                  fill={day.today ? "var(--ink-2)" : "var(--muted)"}
                  fontWeight={day.today ? 650 : 400}
                >
                  {day.label}{day.today ? "*" : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <div className={`tooltip${hovered ? " on" : ""}`} style={hover ? { left: hover.left, top: 30 } : undefined}>
          {hovered && (
            <>
              <div className="t-title">{hovered.label}{hovered.today ? " (today so far)" : ""}</div>
              <div className="t-row">
                <span><span className="tt-swatch" style={{ background: "var(--bar-peak)" }} />Peak</span>
                <b>{hovered.peak.toFixed(1)} kWh</b>
              </div>
              <div className="t-row">
                <span><span className="tt-swatch" style={{ background: "var(--bar-off)" }} />Off-peak</span>
                <b>{hovered.off.toFixed(1)} kWh</b>
              </div>
              <div className="t-row"><span>Total</span><b>{(hovered.peak + hovered.off).toFixed(1)} kWh</b></div>
            </>
          )}
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--bar-peak)" }} />{peakLabel}</span>
        <span><i style={{ background: "var(--bar-off)" }} />Off-peak</span>
      </div>
    </>
  );
}

/* =====================  Sparkline  ===================== */

export function Sparkline({ values, colorVar, label }: { values: number[]; colorVar: string; label: string }) {
  const w = 220, h = 44, n = values.length;
  if (n < 2) return <div className="phase-desc">collecting data…</div>;
  const lo = Math.min(...values) * 0.97;
  const hi = Math.max(...values) * 1.03 || 1;
  const x = (i: number) => 4 + (i / (n - 1)) * (w - 14);
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (h - 8);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(n - 1).toFixed(1)} ${h - 2} L${x(0)} ${h - 2} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      <path d={area} fill={`var(${colorVar})`} opacity={0.13} />
      <path d={d} fill="none" stroke={`var(${colorVar})`} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.5} fill={`var(${colorVar})`} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
