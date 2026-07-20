"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseLoadWorkbook, simulate, type BatterySpec, type ParseResult } from "@/lib/bess";
import type { TariffProfileId } from "@/lib/config";
import { LoadVsShavedChart, SocChart } from "@/components/battery-charts";

const DEFAULT_SPEC: BatterySpec = {
  capacityKwh: 500,
  maxChargeKw: 250,
  maxDischargeKw: 250,
  roundTripEff: 0.92,
};

export default function BatterySim() {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [spec, setSpec] = useState<BatterySpec>(DEFAULT_SPEC);
  const [profile, setProfile] = useState<TariffProfileId>("kilang");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setLoading(true);
    setParseError(null);
    try {
      const buf = await file.arrayBuffer();
      const result = parseLoadWorkbook(buf);
      if (result.points.length === 0) {
        setParseError("No usable rows found. Expected columns: Date, Date, Time, Total.");
        setParsed(null);
      } else {
        setParsed(result);
        setFileName(file.name);
        setSelectedDay(null); // pick default after simulation runs
      }
    } catch (e) {
      setParseError(`Could not read this file: ${(e as Error).message}`);
      setParsed(null);
    } finally {
      setLoading(false);
    }
  }

  const sim = useMemo(() => (parsed ? simulate(parsed.points, spec, profile) : null), [parsed, spec, profile]);

  const bestDay = useMemo(() => {
    if (!sim || sim.perDay.length === 0) return null;
    return sim.perDay.reduce((a, b) => (b.peakKwhBefore > a.peakKwhBefore ? b : a)).date;
  }, [sim]);

  const activeDay = selectedDay ?? bestDay;
  const dayPoints = useMemo(
    () => (sim && activeDay ? sim.points.filter((p) => `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` === activeDay) : []),
    [sim, activeDay]
  );

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <h1>Battery Simulator</h1>
          <p>What-if peak shaving using real historical load data</p>
        </div>
        <div className="head-right">
          <Link className="btn-ghost" href="/">← Real-Time Monitor</Link>
        </div>
      </header>

      <div className="stack">
        <div className="card">
          <h2 className="section-title">1. Load your factory&apos;s data</h2>
          <p className="section-sub">
            Excel export with columns Date, Date, Time, Total (kW) — one row per minute. Nothing is
            uploaded anywhere; it&apos;s parsed right here in your browser.
          </p>
          <div
            className={`dropzone${dragOver ? " over" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {loading ? (
              <p>Reading file…</p>
            ) : parsed ? (
              <p>
                <strong>{fileName}</strong> — {parsed.points.length.toLocaleString()} readings across{" "}
                {parsed.days.length} days
                {parsed.skippedRows > 0 && ` (${parsed.skippedRows} rows skipped — broken cells)`}.
                Click or drop to replace.
              </p>
            ) : (
              <p>Click to choose a file, or drag it here (.xlsx)</p>
            )}
          </div>
          {parseError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{parseError}</div>}
        </div>

        {sim && parsed && (
          <>
            <div className="card">
              <h2 className="section-title">2. Battery you&apos;re considering</h2>
              <p className="section-sub">Adjust to compare different battery sizes against the same data</p>
              <div className="spec-grid">
                <SpecField label="Capacity" unit="kWh" value={spec.capacityKwh} onChange={(v) => setSpec((s) => ({ ...s, capacityKwh: v }))} />
                <SpecField label="Max charge rate" unit="kW" value={spec.maxChargeKw} onChange={(v) => setSpec((s) => ({ ...s, maxChargeKw: v }))} />
                <SpecField label="Max discharge rate" unit="kW" value={spec.maxDischargeKw} onChange={(v) => setSpec((s) => ({ ...s, maxDischargeKw: v }))} />
                <SpecField
                  label="Round-trip efficiency"
                  unit="%"
                  value={Math.round(spec.roundTripEff * 100)}
                  onChange={(v) => setSpec((s) => ({ ...s, roundTripEff: Math.min(100, Math.max(1, v)) / 100 }))}
                />
                <div className="spec-field">
                  <label>Tariff</label>
                  <div className="seg">
                    <button className={profile === "kilang" ? "on" : ""} onClick={() => setProfile("kilang")}>Kilang</button>
                    <button className={profile === "rumah" ? "on" : ""} onClick={() => setProfile("rumah")}>Rumah</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="kpis" style={{ marginBottom: 0 }}>
              <div className="card kpi">
                <div className="label">Est. Savings ({parsed.days.length}-day period)</div>
                <div className="value"><small style={{ margin: "0 2px 0 0" }}>RM</small>{sim.totals.savingsRm.toFixed(2)}</div>
                <div className="sub">
                  <span className="chip-good">{sim.totals.savingsPct.toFixed(1)}% lower than TNB-only</span>
                </div>
              </div>
              <div className="card kpi">
                <div className="label">Peak Energy Shifted</div>
                <div className="value">{sim.totals.kwhShiftedPeakToOff.toFixed(0)}<small>kWh</small></div>
                <div className="sub">moved from peak-rate to off-peak-rate charging</div>
              </div>
              <div className="card kpi">
                <div className="label">Typical Time to Full Charge</div>
                <div className="value">{sim.totals.avgChargeMinutes !== null ? fmtDuration(sim.totals.avgChargeMinutes) : "—"}</div>
                <div className="sub">from start of off-peak (22:00)</div>
              </div>
              <div className="card kpi">
                <div className="label">Typical Time Held Into Peak</div>
                <div className="value">
                  {sim.totals.avgHoursHeldInPeak !== null ? `${sim.totals.avgHoursHeldInPeak.toFixed(1)}h` : "all 8h"}
                </div>
                <div className="sub">before battery empties and TNB takes back over</div>
              </div>
            </div>

            <div className="card">
              <div className="section-title-row">
                <div>
                  <h2 className="section-title">Load: with vs without battery</h2>
                  <p className="section-sub">Dashed = TNB only (today) · Solid = with battery</p>
                </div>
                <select className="day-select" value={activeDay ?? ""} onChange={(e) => setSelectedDay(e.target.value)}>
                  {sim.perDay.map((d) => (
                    <option key={d.date} value={d.date}>{d.date}{d.date === bestDay ? " (highest peak)" : ""}</option>
                  ))}
                </select>
              </div>
              <LoadVsShavedChart day={dayPoints} />
            </div>

            <div className="card">
              <h2 className="section-title">Battery state of charge — {activeDay}</h2>
              <p className="section-sub">Charges through the night, discharges to cover peak-hour load</p>
              <SocChart day={dayPoints} capacityKwh={spec.capacityKwh} />
            </div>

            <div className="card">
              <h2 className="section-title">Day-by-day breakdown</h2>
              <div className="scroll-x">
                <table className="bess-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Peak kWh before</th><th>Peak kWh after</th>
                      <th>Cost before (RM)</th><th>Cost after (RM)</th><th>Charged by</th><th>Ran out at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.perDay.map((d) => (
                      <tr key={d.date} className={d.date === activeDay ? "active" : ""}>
                        <td>{d.date}</td>
                        <td>{d.peakKwhBefore.toFixed(0)}</td>
                        <td>{d.peakKwhAfter.toFixed(0)}</td>
                        <td>{d.costBefore.toFixed(2)}</td>
                        <td>{d.costAfter.toFixed(2)}</td>
                        <td>{d.chargedFullyBy ?? "—"}</td>
                        <td>{d.ranOutAt ?? "lasted all peak"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <footer>
        Assumptions: negative &quot;Total&quot; readings (solar export) are treated as zero load — the
        battery doesn&apos;t act on them. Efficiency loss is applied on both charge and discharge.
        This is a planning estimate, not a substitute for a proper BESS sizing study.
      </footer>
    </div>
  );
}

function SpecField({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="spec-field">
      <label>{label} ({unit})</label>
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
