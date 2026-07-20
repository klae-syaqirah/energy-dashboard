// Battery Energy Storage System (BESS) peak-shaving simulator.
// Runs entirely client-side: parse Mr. Lam's minute-interval export, then
// simulate "what if we had a battery of this size?" against the real load.

import * as XLSX from "xlsx";
import { PEAK_START_HOUR, PEAK_END_HOUR, PUBLIC_HOLIDAYS, TARIFF_PROFILES, type TariffProfileId } from "@/lib/config";

export type LoadPoint = {
  /** Minutes since the first sample — a simple, timezone-free local clock. */
  t: number;
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** Net grid demand, kW. Can be negative (exporting excess solar). */
  kw: number;
};

export type ParseResult = {
  points: LoadPoint[];
  skippedRows: number;
  days: string[]; // YYYY-MM-DD, in order
};

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const WEEKDAY_FROM_YMD = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Mon-Fri, within the ToU peak hours, and not a gazetted holiday — using the
 * spreadsheet's own local wall-clock fields (no timezone conversion needed:
 * the export is already in factory local time). */
export function isPeakLocal(p: Pick<LoadPoint, "year" | "month" | "day" | "hour">): boolean {
  const dow = WEEKDAY_FROM_YMD(p.year, p.month, p.day);
  if (dow === 0 || dow === 6) return false;
  if (PUBLIC_HOLIDAYS.includes(dateKey(p.year, p.month, p.day))) return false;
  return p.hour >= PEAK_START_HOUR && p.hour < PEAK_END_HOUR;
}

/** Parse Mr. Lam's export: columns Date, Date (merged, ignored), Time, Total (kW).
 * Skips rows with broken formulas (#REF! etc.) or missing values. */
export function parseLoadWorkbook(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const points: LoadPoint[] = [];
  const daySet = new Set<string>();
  let skipped = 0;
  let t = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateCell = row[0];
    const timeCell = row[2];
    const totalCell = row[3];

    if (!(dateCell instanceof Date) || typeof totalCell !== "number" || !Number.isFinite(totalCell)) {
      skipped++;
      continue;
    }
    // Excel time-only cells decode as a Date on 1899-12-30; take just the hour/minute.
    const hour = timeCell instanceof Date ? timeCell.getHours() : Math.floor(Number(timeCell ?? 0) * 24) % 24;
    const minute = timeCell instanceof Date ? timeCell.getMinutes() : Math.round((Number(timeCell ?? 0) * 24 * 60) % 60);

    const year = dateCell.getFullYear();
    const month = dateCell.getMonth() + 1;
    const day = dateCell.getDate();
    daySet.add(dateKey(year, month, day));
    points.push({ t: t++, year, month, day, hour, minute, kw: totalCell });
  }

  return { points, skippedRows: skipped, days: Array.from(daySet).sort() };
}

export type BatterySpec = {
  capacityKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  roundTripEff: number; // 0-1, e.g. 0.92
};

export type SimPoint = LoadPoint & {
  socKwh: number;
  gridKw: number; // what's actually drawn from TNB after the battery helps
  batteryKw: number; // + = discharging to serve load, - = charging from grid
};

export type DaySummary = {
  date: string;
  peakKwhBefore: number;
  peakKwhAfter: number;
  offPeakKwhBefore: number;
  offPeakKwhAfter: number;
  costBefore: number;
  costAfter: number;
  chargedFullyBy: string | null; // "HH:MM" battery first hit 100% during off-peak, or null
  ranOutAt: string | null; // "HH:MM" battery first hit 0% during peak, or null if it lasted all peak
};

export type SimResult = {
  points: SimPoint[];
  perDay: DaySummary[];
  totals: {
    kwhShiftedPeakToOff: number;
    costBefore: number;
    costAfter: number;
    savingsRm: number;
    savingsPct: number;
    avgChargeMinutes: number | null;
    avgHoursHeldInPeak: number | null;
  };
};

const MIN_PER_STEP = 1 / 60; // hours

/** Simulate the battery over the whole series, minute by minute, carrying
 * state-of-charge across day boundaries. Discharge strategy: cover as much
 * of peak-hour load as the battery's power rating allows, every minute,
 * until empty — then the grid (TNB) takes over for the rest. */
export function simulate(points: LoadPoint[], spec: BatterySpec, profile: TariffProfileId): SimResult {
  const tariff = TARIFF_PROFILES[profile];
  const chargeEff = Math.sqrt(spec.roundTripEff);
  const dischargeEff = Math.sqrt(spec.roundTripEff);

  let soc = 0;
  const out: SimPoint[] = [];
  const byDay = new Map<string, DaySummary & { _chargedFullyAt: number | null; _ranOutAt: number | null; _wasFull: boolean; _wasPeakActive: boolean }>();

  for (const p of points) {
    const peak = isPeakLocal(p);
    const key = dateKey(p.year, p.month, p.day);
    if (!byDay.has(key)) {
      byDay.set(key, {
        date: key,
        peakKwhBefore: 0, peakKwhAfter: 0, offPeakKwhBefore: 0, offPeakKwhAfter: 0,
        costBefore: 0, costAfter: 0,
        chargedFullyBy: null, ranOutAt: null,
        _chargedFullyAt: null, _ranOutAt: null, _wasFull: false, _wasPeakActive: false,
      });
    }
    const d = byDay.get(key)!;

    const rawLoad = Math.max(0, p.kw); // negative = exporting solar surplus; battery doesn't act on it
    let gridKw = rawLoad;
    let batteryKw = 0;

    if (peak) {
      const dischargeableKw = Math.min(spec.maxDischargeKw, soc * dischargeEff * 60);
      const drawKw = Math.min(dischargeableKw, rawLoad);
      if (drawKw > 0) {
        batteryKw = drawKw;
        gridKw = rawLoad - drawKw;
        soc -= drawKw * MIN_PER_STEP / dischargeEff;
        if (soc < 0.001) soc = 0;
      }
      d._wasPeakActive = true;
      if (soc <= 0 && d._ranOutAt === null && d._wasPeakActive) d._ranOutAt = p.t;
    } else {
      const roomKw = Math.min(spec.maxChargeKw, (spec.capacityKwh - soc) / chargeEff * 60);
      if (roomKw > 0) {
        batteryKw = -roomKw;
        gridKw = rawLoad + roomKw;
        soc += roomKw * MIN_PER_STEP * chargeEff;
        if (soc > spec.capacityKwh) soc = spec.capacityKwh;
      }
      if (soc >= spec.capacityKwh - 0.001 && !d._wasFull) {
        d._wasFull = true;
        d._chargedFullyAt = p.t;
      }
    }

    const rateBefore = peak ? tariff.peakRm : tariff.offRm;
    const rateAfter = rateBefore;
    d.costBefore += rawLoad * MIN_PER_STEP * rateBefore;
    d.costAfter += gridKw * MIN_PER_STEP * rateAfter;
    if (peak) {
      d.peakKwhBefore += rawLoad * MIN_PER_STEP;
      d.peakKwhAfter += gridKw * MIN_PER_STEP;
    } else {
      d.offPeakKwhBefore += rawLoad * MIN_PER_STEP;
      d.offPeakKwhAfter += gridKw * MIN_PER_STEP;
    }

    out.push({ ...p, socKwh: soc, gridKw, batteryKw });
  }

  const fmtHM = (p: LoadPoint) => `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const byT = new Map(points.map((p) => [p.t, p]));
  const perDay: DaySummary[] = Array.from(byDay.values()).map((d) => ({
    date: d.date,
    peakKwhBefore: round2(d.peakKwhBefore),
    peakKwhAfter: round2(d.peakKwhAfter),
    offPeakKwhBefore: round2(d.offPeakKwhBefore),
    offPeakKwhAfter: round2(d.offPeakKwhAfter),
    costBefore: round2(d.costBefore),
    costAfter: round2(d.costAfter),
    chargedFullyBy: d._chargedFullyAt !== null ? fmtHM(byT.get(d._chargedFullyAt)!) : null,
    ranOutAt: d._ranOutAt !== null ? fmtHM(byT.get(d._ranOutAt)!) : null,
  }));

  const costBefore = sum(perDay.map((d) => d.costBefore));
  const costAfter = sum(perDay.map((d) => d.costAfter));
  const kwhShifted = sum(perDay.map((d) => d.peakKwhBefore - d.peakKwhAfter));

  const chargeMinutes = perDay
    .filter((d) => d.chargedFullyBy)
    .map((d) => minutesFromFirstOffPeakStart(d));
  const heldHours = perDay
    .filter((d) => d.ranOutAt)
    .map((d) => hoursIntoPeak(d));

  return {
    points: out,
    perDay,
    totals: {
      kwhShiftedPeakToOff: round2(kwhShifted),
      costBefore: round2(costBefore),
      costAfter: round2(costAfter),
      savingsRm: round2(costBefore - costAfter),
      savingsPct: costBefore > 0 ? round2(((costBefore - costAfter) / costBefore) * 100) : 0,
      avgChargeMinutes: chargeMinutes.length ? Math.round(avg(chargeMinutes)) : null,
      avgHoursHeldInPeak: heldHours.length ? round2(avg(heldHours)) : null,
    },
  };
}

// Off-peak (this ToU scheme) starts right after peak ends, i.e. PEAK_END_HOUR.
function minutesFromFirstOffPeakStart(d: DaySummary): number {
  const [h, m] = d.chargedFullyBy!.split(":").map(Number);
  const startMin = PEAK_END_HOUR * 60;
  const atMin = h < PEAK_START_HOUR ? h * 60 + m + (24 - PEAK_END_HOUR) * 60 : h * 60 + m - startMin;
  return atMin;
}
function hoursIntoPeak(d: DaySummary): number {
  const [h, m] = d.ranOutAt!.split(":").map(Number);
  return h + m / 60 - PEAK_START_HOUR;
}

function sum(a: number[]) { return a.reduce((x, y) => x + y, 0); }
function avg(a: number[]) { return sum(a) / a.length; }
function round2(n: number) { return Math.round(n * 100) / 100; }
