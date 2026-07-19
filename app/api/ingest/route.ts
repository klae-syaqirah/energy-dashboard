import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readings, type NewReading } from "@/lib/schema";

export const dynamic = "force-dynamic";

type IngestBody = {
  ts?: string;
  v1?: number; v2?: number; v3?: number;
  a1?: number; a2?: number; a3?: number;
  kw1?: number; kw2?: number; kw3?: number;
  kw_total: number;
  pf?: number;
  freq?: number;
  energy_kwh?: number;
  energy_export_kwh?: number;
  ct_ratio?: number;
  vt_ratio?: number;
  v_assym?: number;
  thd_v1?: number; thd_v2?: number; thd_v3?: number;
  thd_i1?: number; thd_i2?: number; thd_i3?: number;
  max_dmd_kw?: number;
};

function toRow(r: IngestBody): NewReading {
  if (typeof r.kw_total !== "number" || !Number.isFinite(r.kw_total)) {
    throw new Error("kw_total (number) is required");
  }
  return {
    ts: r.ts ? new Date(r.ts) : new Date(),
    v1: r.v1, v2: r.v2, v3: r.v3,
    a1: r.a1, a2: r.a2, a3: r.a3,
    kw1: r.kw1, kw2: r.kw2, kw3: r.kw3,
    kwTotal: r.kw_total,
    pf: r.pf,
    freq: r.freq,
    energyKwh: r.energy_kwh,
    energyExportKwh: r.energy_export_kwh,
    ctRatio: r.ct_ratio,
    vtRatio: r.vt_ratio,
    vAssym: r.v_assym,
    thdV1: r.thd_v1, thdV2: r.thd_v2, thdV3: r.thd_v3,
    thdI1: r.thd_i1, thdI2: r.thd_i2, thdI3: r.thd_i3,
    maxDmdKw: r.max_dmd_kw,
  };
}

export async function POST(req: NextRequest) {
  const key = process.env.INGEST_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "INGEST_API_KEY not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Accepts a single reading or an array (bridge can flush a buffer after an outage).
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0 || items.length > 1000) {
    return NextResponse.json({ error: "expected 1–1000 readings" }, { status: 400 });
  }

  let rows: NewReading[];
  try {
    rows = items.map((r) => toRow(r as IngestBody));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    await getDb().insert(readings).values(rows);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: rows.length });
}
