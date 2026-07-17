import {
  bigserial,
  doublePrecision,
  index,
  pgTable,
  real,
  timestamp,
} from "drizzle-orm/pg-core";

export const readings = pgTable(
  "readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    v1: real("v1"),
    v2: real("v2"),
    v3: real("v3"),
    a1: real("a1"),
    a2: real("a2"),
    a3: real("a3"),
    kw1: real("kw1"),
    kw2: real("kw2"),
    kw3: real("kw3"),
    kwTotal: real("kw_total").notNull(),
    pf: real("pf"),
    freq: real("freq"),
    // lifetime energy counters from the meter (kWh) — monotonic, survive gaps
    energyKwh: doublePrecision("energy_kwh"),
    energyExportKwh: doublePrecision("energy_export_kwh"),
    // CT/VT ratio configured in the instrument at reading time (varies per installation)
    ctRatio: real("ct_ratio"),
    vtRatio: real("vt_ratio"),
  },
  (t) => [index("readings_ts_idx").on(t.ts)]
);

export type Reading = typeof readings.$inferSelect;
export type NewReading = typeof readings.$inferInsert;
