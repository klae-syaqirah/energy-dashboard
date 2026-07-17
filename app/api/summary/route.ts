import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import {
  isPeakEpoch,
  klMidnightUtc,
  KL_OFFSET_MS,
  PEAK_START_HOUR,
  PEAK_END_HOUR,
  TARIFF_RM_PER_KWH,
} from "@/lib/config";

export const dynamic = "force-dynamic";

export type SummaryBucket = {
  e: number; // bucket start, UTC epoch seconds
  kw: number;
  a1: number | null;
  a2: number | null;
  a3: number | null;
};

export type Summary = {
  latest: {
    ts: string;
    v1: number | null; v2: number | null; v3: number | null;
    a1: number | null; a2: number | null; a3: number | null;
    kw1: number | null; kw2: number | null; kw3: number | null;
    kwTotal: number;
    pf: number | null;
    freq: number | null;
    energyKwh: number | null;
    energyExportKwh: number | null;
    ctRatio: number | null;
    vtRatio: number | null;
  } | null;
  today: {
    series: SummaryBucket[];
    kwhTotal: number;
    kwhPeak: number;
    kwhOff: number;
    costRm: number;
  };
  daily: { label: string; peak: number; off: number; today: boolean }[];
  config: { peakStartHour: number; peakEndHour: number; tariffRm: number };
};

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  timeZone: "Asia/Kuala_Lumpur",
});

export async function GET() {
  try {
    return await buildSummary();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function buildSummary() {
  const sql = getSql();
  const todayStart = klMidnightUtc(0);
  const weekStart = klMidnightUtc(6);

  const [latestRows, todayRows, weekRows] = await Promise.all([
    sql`SELECT ts, v1, v2, v3, a1, a2, a3, kw1, kw2, kw3,
               kw_total AS "kwTotal", pf, freq, energy_kwh AS "energyKwh",
               energy_export_kwh AS "energyExportKwh",
               ct_ratio AS "ctRatio", vt_ratio AS "vtRatio"
        FROM readings ORDER BY ts DESC LIMIT 1`,
    sql`SELECT floor(extract(epoch FROM ts) / 300) * 300 AS e,
               avg(kw_total) AS kw, avg(a1) AS a1, avg(a2) AS a2, avg(a3) AS a3
        FROM readings WHERE ts >= ${todayStart.toISOString()}
        GROUP BY 1 ORDER BY 1`,
    sql`SELECT floor(extract(epoch FROM ts) / 3600) * 3600 AS e,
               avg(kw_total) AS kw
        FROM readings WHERE ts >= ${weekStart.toISOString()}
        GROUP BY 1 ORDER BY 1`,
  ]);

  // --- today: 5-min buckets → kWh totals (each bucket ≈ avg kW × 1/12 h)
  const series: SummaryBucket[] = todayRows.map((r) => ({
    e: Number(r.e),
    kw: Number(r.kw),
    a1: r.a1 === null ? null : Number(r.a1),
    a2: r.a2 === null ? null : Number(r.a2),
    a3: r.a3 === null ? null : Number(r.a3),
  }));
  let kwhPeak = 0;
  let kwhOff = 0;
  for (const b of series) {
    const kwh = b.kw / 12;
    if (isPeakEpoch(b.e)) kwhPeak += kwh;
    else kwhOff += kwh;
  }
  const kwhTotal = kwhPeak + kwhOff;

  // --- last 7 days: hourly buckets → per-KL-day peak/off split
  const todayKey = klDayKey(Date.now() / 1000);
  const byDay = new Map<string, { label: string; peak: number; off: number; today: boolean }>();
  // Pre-seed all 7 days so days without data still show as zero bars
  for (let i = 6; i >= 0; i--) {
    const d = klMidnightUtc(i);
    const key = klDayKey(d.getTime() / 1000 + 60); // nudge inside the day
    byDay.set(key, {
      label: DAY_LABEL.format(new Date(d.getTime() + KL_OFFSET_MS)),
      peak: 0,
      off: 0,
      today: key === todayKey,
    });
  }
  for (const r of weekRows) {
    const e = Number(r.e);
    const day = byDay.get(klDayKey(e));
    if (!day) continue;
    const kwh = Number(r.kw); // hourly bucket: avg kW × 1 h
    if (isPeakEpoch(e)) day.peak += kwh;
    else day.off += kwh;
  }

  const latest = latestRows[0]
    ? {
        ...latestRows[0],
        ts: new Date(latestRows[0].ts as string | Date).toISOString(),
      }
    : null;

  const summary: Summary = {
    latest: latest as Summary["latest"],
    today: {
      series,
      kwhTotal: round1(kwhTotal),
      kwhPeak: round1(kwhPeak),
      kwhOff: round1(kwhOff),
      costRm: Math.round(kwhTotal * TARIFF_RM_PER_KWH * 100) / 100,
    },
    daily: Array.from(byDay.values()).map((d) => ({
      ...d,
      peak: round1(d.peak),
      off: round1(d.off),
    })),
    config: {
      peakStartHour: PEAK_START_HOUR,
      peakEndHour: PEAK_END_HOUR,
      tariffRm: TARIFF_RM_PER_KWH,
    },
  };
  return NextResponse.json(summary);
}

function klDayKey(epochSec: number): string {
  const kl = new Date(epochSec * 1000 + KL_OFFSET_MS);
  return `${kl.getUTCFullYear()}-${kl.getUTCMonth() + 1}-${kl.getUTCDate()}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
