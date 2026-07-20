import { readFileSync } from "fs";
import { parseLoadWorkbook, simulate } from "./lib/bess";

const buf = readFileSync("docs/raw-data.xlsx");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const parsed = parseLoadWorkbook(ab as ArrayBuffer);
console.log("points:", parsed.points.length, "skipped:", parsed.skippedRows, "days:", parsed.days.length);
console.log("first point:", parsed.points[0]);
console.log("last point:", parsed.points[parsed.points.length - 1]);

const sim = simulate(parsed.points, { capacityKwh: 500, maxChargeKw: 250, maxDischargeKw: 250, roundTripEff: 0.92 }, "kilang");
console.log("\ntotals:", sim.totals);
console.log("EXPECT: savingsRm should now be positive (~+RM120-140 for a 500kWh/250kW battery over 21 days)");
console.log("\nfirst 3 day summaries:");
for (const d of sim.perDay.slice(0, 3)) console.log(" ", d);

// sanity: SoC should never exceed capacity or go negative
const bad = sim.points.filter((p) => p.socKwh < -0.01 || p.socKwh > 500.01);
console.log("\nSoC out-of-range points:", bad.length);

// sanity: gridKw should never be negative when rawLoad>=0 (battery shouldn't create demand)
const badGrid = sim.points.filter((p) => p.kw >= 0 && p.gridKw < -0.01);
console.log("gridKw negative while load>=0:", badGrid.length);

const sumField = (f: (d: (typeof sim.perDay)[number]) => number) => sim.perDay.reduce((a, d) => a + f(d), 0);
const peakBefore = sumField((d) => d.peakKwhBefore);
const peakAfter = sumField((d) => d.peakKwhAfter);
const offBefore = sumField((d) => d.offPeakKwhBefore);
const offAfter = sumField((d) => d.offPeakKwhAfter);
console.log("\npeak kWh before/after:", peakBefore, peakAfter, "shifted:", peakBefore - peakAfter);
console.log("off kWh before/after:", offBefore, offAfter, "extra drawn:", offAfter - offBefore);
console.log("implied round-trip on energy:", (peakBefore - peakAfter) / (offAfter - offBefore));

const peakRate = 0.3132, offRate = 0.2723;
const expectedPeakSaving = (peakBefore - peakAfter) * peakRate;
const expectedOffCost = (offAfter - offBefore) * offRate;
console.log("expected peak $ saved:", expectedPeakSaving, "expected extra off $ spent:", expectedOffCost, "net:", expectedPeakSaving - expectedOffCost);

// direct minute-level check: for peak minutes, is gridKw + batteryKw == kw (floored at 0)?
let mismatches = 0;
for (const p of sim.points) {
  const raw = Math.max(0, p.kw);
  if (p.batteryKw > 0 && Math.abs(p.gridKw + p.batteryKw - raw) > 0.01) mismatches++;
}
console.log("discharge-minute balance mismatches:", mismatches);

console.log("\nfinal SoC (kWh, stranded energy if data just ends mid-cycle):", sim.points[sim.points.length - 1].socKwh);
console.log("expected round trip if we credit stranded soc as 'future peak kWh':");
const strandedGridEquivalent = sim.points[sim.points.length - 1].socKwh; // already in "delivered-equivalent" storage units
const adjustedRoundTrip = (peakBefore - peakAfter + strandedGridEquivalent * Math.sqrt(0.92)) / (offAfter - offBefore);
console.log(" ->", adjustedRoundTrip);
