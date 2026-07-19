import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLS = [
  "ts", "v1", "v2", "v3", "a1", "a2", "a3", "kw1", "kw2", "kw3", "kw_total",
  "pf", "freq", "energy_kwh", "energy_export_kwh", "v_assym",
  "thd_v1", "thd_v2", "thd_v3", "thd_i1", "thd_i2", "thd_i3",
  "max_dmd_kw", "ct_ratio", "vt_ratio",
] as const;

// CSV download for Excel analysis. Raw rows, capped so the function stays fast.
export async function GET(req: NextRequest) {
  const days = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "7")));
  try {
    const sql = getSql();
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await sql`
      SELECT ts, v1, v2, v3, a1, a2, a3, kw1, kw2, kw3, kw_total,
             pf, freq, energy_kwh, energy_export_kwh, v_assym,
             thd_v1, thd_v2, thd_v3, thd_i1, thd_i2, thd_i3,
             max_dmd_kw, ct_ratio, vt_ratio
      FROM readings WHERE ts >= ${since.toISOString()}
      ORDER BY ts LIMIT 200000`;

    const lines = [COLS.join(",")];
    for (const r of rows) {
      lines.push(
        COLS.map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return "";
          if (c === "ts") return new Date(v as string | Date).toISOString();
          return String(v);
        }).join(",")
      );
    }

    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="readings-last-${days}d.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
