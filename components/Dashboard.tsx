"use client";

import { useEffect, useState } from "react";
import type { Summary } from "@/app/api/summary/route";
import { Gauge, LoadChart, Sparkline, WeeklyBars, niceMax } from "@/components/charts";

const POLL_MS = 10_000;

const CLOCK_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuala_Lumpur",
});

function klNowParts(now: Date) {
  const kl = new Date(now.getTime() + 8 * 3600 * 1000);
  return { hour: kl.getUTCHours(), dow: kl.getUTCDay() };
}

function klDateKey(d: Date): string {
  const kl = new Date(d.getTime() + 8 * 3600 * 1000);
  const m = String(kl.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kl.getUTCDate()).padStart(2, "0");
  return `${kl.getUTCFullYear()}-${m}-${day}`;
}

export default function Dashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [profile, setProfile] = useState<"kilang" | "rumah">("kilang");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/summary", { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}: ${(await res.json()).error ?? res.statusText}`);
        if (alive) {
          setData(await res.json());
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(new Date()), 1000);
    const firstTick = setTimeout(() => setNow(new Date()), 0);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
      clearTimeout(firstTick);
    };
  }, []);

  const latest = data?.latest ?? null;
  const cfg = data?.config;
  const { hour, dow } = klNowParts(now ?? new Date(0));
  const holidayToday = !!now && !!cfg && cfg.holidays.includes(klDateKey(now));
  const peakNow =
    !!now && dow >= 1 && dow <= 5 && !holidayToday && !!cfg &&
    hour >= cfg.peakStartHour && hour < cfg.peakEndHour;
  const ageSec = latest && now ? (now.getTime() - new Date(latest.ts).getTime()) / 1000 : null;
  const live = ageSec !== null && ageSec < 30;

  const gaugeMax = niceMax(
    Math.max(latest?.kwTotal ?? 0, ...(data?.today.series.map((b) => b.kw) ?? [0])),
    60
  );
  const peakPct =
    data && data.today.kwhTotal > 0
      ? Math.round((data.today.kwhPeak / data.today.kwhTotal) * 100)
      : null;

  const phases = latest
    ? ([
        { name: "L1", tok: "--phase-1", v: latest.v1, a: latest.a1, kw: latest.kw1, key: "a1" as const },
        { name: "L2", tok: "--phase-2", v: latest.v2, a: latest.a2, kw: latest.kw2, key: "a2" as const },
        { name: "L3", tok: "--phase-3", v: latest.v3, a: latest.a3, kw: latest.kw3, key: "a3" as const },
      ])
    : [];
  const lastHour = data?.today.series.slice(-12) ?? [];

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <h1>Factory Energy Monitor</h1>
          <p>PQM-1000s · Modbus RTU · updates every 10 s</p>
        </div>
        <div className="head-right">
          <span className="live">
            <span className={`live-dot${live ? "" : " stale"}`} />
            {live ? "Live" : "No signal"}
          </span>
          {now && <span className="clock" suppressHydrationWarning>{CLOCK_FMT.format(now)}</span>}
          {cfg && (
            <span className={peakNow ? "pill-peak" : "pill-off"}>
              <svg width={13} height={13} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M9.5 1 3 9h3.5L6 15l6.5-8H9z" />
              </svg>
              {peakNow ? "PEAK HOURS" : "OFF-PEAK"} · {String(cfg.peakStartHour).padStart(2, "0")}:00–
              {String(cfg.peakEndHour).padStart(2, "0")}:00
            </span>
          )}
        </div>
      </header>

      {error && <div className="error-banner">Cannot reach the data API: {error}</div>}
      {!error && latest && ageSec !== null && ageSec > 60 && (
        <div className="error-banner">
          Last reading was {formatAge(ageSec)} ago — is the Python bridge running (and the laptop awake)?
        </div>
      )}

      {!data && !error && (
        <div className="card waiting">
          <h2>Loading…</h2>
        </div>
      )}

      {data && !latest && (
        <div className="card waiting">
          <h2>No readings yet</h2>
          <p>
            The database is connected but empty. Start the bridge on the laptop connected to the
            PQM-1000s: <code>python bridge/pqm_bridge.py --push</code> — the first numbers will
            appear here within seconds.
          </p>
        </div>
      )}

      {data && latest && (
        <div className="stack">
          <div className="grid-phases">
            {phases.map((p) => (
              <div className="card" key={p.name}>
                <div className="phase-head">
                  <span className="phase-swatch" style={{ background: `var(${p.tok})` }} />
                  <span className="phase-name">Phase {p.name}</span>
                  <span className="phase-desc">L–N</span>
                </div>
                <div className="phase-rows">
                  <div className="phase-row"><span className="k">Voltage</span><span className="v">{fmt(p.v, 1, " V")}</span></div>
                  <div className="phase-row"><span className="k">Current</span><span className="v">{fmt(p.a, 1, " A")}</span></div>
                  <div className="phase-row"><span className="k">Active power</span><span className="v">{fmt(p.kw, 2, " kW")}</span></div>
                </div>
                <div className="phase-desc" style={{ marginBottom: 4 }}>Current · last hour</div>
                <Sparkline
                  values={lastHour.map((b) => b[p.key]).filter((v): v is number => v !== null)}
                  colorVar={p.tok}
                  label={`Phase ${p.name} current trend, last hour`}
                />
              </div>
            ))}
          </div>

          <div className="kpis" style={{ marginBottom: 0 }}>
            <div className="card kpi">
              <div className="label">Total Active Power</div>
              <Gauge value={latest.kwTotal} max={gaugeMax} />
              <div className="sub">scale 0–{gaugeMax} kW · freq {latest.freq?.toFixed(2) ?? "—"} Hz</div>
            </div>
            <div className="card kpi">
              <div className="label">Energy Today</div>
              <div className="value">
                {data.today.kwhTotal < 100 ? data.today.kwhTotal.toFixed(1) : Math.round(data.today.kwhTotal)}
                <small>kWh</small>
              </div>
              <div className="sub">{peakPct !== null ? `${peakPct}% consumed during peak hours` : "no data yet today"}</div>
            </div>
            <div className="card kpi">
              <div className="label">Power Factor</div>
              <div className="value">{latest.pf !== null ? latest.pf.toFixed(2) : "—"}</div>
              <div className="sub">
                {latest.pf !== null && latest.pf >= 0.9 ? (
                  <span className="chip-good">
                    <CheckIcon /> OK — above 0.90 threshold
                  </span>
                ) : (
                  <span className="chip-warn">
                    <BoltIcon /> Below 0.90 — TNB penalty risk
                  </span>
                )}
              </div>
            </div>
            <div className="card kpi">
              <div className="label-row">
                <div className="label">Est. Cost Today</div>
                <div className="seg" role="group" aria-label="Tariff profile">
                  <button className={profile === "kilang" ? "on" : ""} onClick={() => setProfile("kilang")}>
                    Kilang
                  </button>
                  <button className={profile === "rumah" ? "on" : ""} onClick={() => setProfile("rumah")}>
                    Rumah
                  </button>
                </div>
              </div>
              <div className="value">
                <small style={{ margin: "0 2px 0 0" }}>RM</small>
                {(
                  data.today.kwhPeak * data.config.tariffs[profile].peakRm +
                  data.today.kwhOff * data.config.tariffs[profile].offRm
                ).toFixed(2)}
              </div>
              <div className="sub">
                RM {data.config.tariffs[profile].peakRm.toFixed(4)} peak · RM{" "}
                {data.config.tariffs[profile].offRm.toFixed(4)} off-peak /kWh
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Total load today (kW)</h2>
            <p className="section-sub">5-minute averages since midnight — shaded band is the TNB peak window</p>
            <LoadChart
              series={data.today.series}
              peakStartHour={data.config.peakStartHour}
              peakEndHour={data.config.peakEndHour}
            />
          </div>

          <div className="card">
            <h2 className="section-title">Daily consumption — last 7 days (kWh)</h2>
            <p className="section-sub">
              Split by ToU tariff window · weekends &amp; public holidays count as off-peak · * today is partial
            </p>
            <WeeklyBars
              days={data.daily}
              peakLabel={`Peak (${String(data.config.peakStartHour).padStart(2, "0")}:00–${String(data.config.peakEndHour).padStart(2, "0")}:00)`}
            />
          </div>
        </div>
      )}

      <footer>
        {latest && (
          <div style={{ marginBottom: 6 }}>
            Meter settings: CT ratio {latest.ctRatio ?? "—"} · VT ratio {latest.vtRatio ?? "—"} (read
            from the instrument) · lifetime energy — import {fmtKwh(latest.energyKwh)}, export{" "}
            {fmtKwh(latest.energyExportKwh)}
          </div>
        )}
        Data flows: PQM-1000s → RS485 → Python bridge → API → Neon → this dashboard. Gaps appear
        when the bridge laptop is off — that is expected for the prototype.
      </footer>
    </div>
  );
}

function fmt(v: number | null, dp: number, unit: string): string {
  return v === null ? "—" : `${v.toFixed(dp)}${unit}`;
}

function fmtKwh(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("en-MY", { maximumFractionDigits: 1 })} kWh`;
}

function formatAge(sec: number): string {
  if (sec < 120) return `${Math.round(sec)} s`;
  if (sec < 7200) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

function CheckIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 12.2 2.6 8.3l1.4-1.4 2.5 2.5 5.5-5.6 1.4 1.4z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 1 3 9h3.5L6 15l6.5-8H9z" />
    </svg>
  );
}
