// TNB ToU tariff settings (RP4, effective 1 July 2025).
// Malaysia has no DST, so a fixed UTC+8 offset is safe.
export const KL_OFFSET_MS = 8 * 3600 * 1000;

// ToU peak window: Mon–Fri 14:00–22:00. Everything else (incl. weekends and
// gazetted public holidays) is off-peak.
export const PEAK_START_HOUR = 14; // 14:00 KL
export const PEAK_END_HOUR = 22; // 22:00 KL

// The 15 gazetted ToU public holidays (whole day off-peak), KL dates YYYY-MM-DD.
// Fixed-date holidays are filled for 2026; ADD the movable ones (CNY, Hari Raya
// Aidilfitri & Aidiladha, Wesak, Agong's birthday, Awal Muharram, Maulidur
// Rasul, Deepavali) once the official 2026 calendar is confirmed.
export const PUBLIC_HOLIDAYS: string[] = [
  "2026-01-01", // New Year's Day
  "2026-05-01", // Labour Day
  "2026-08-31", // Independence Day
  "2026-09-16", // Malaysia Day
  "2026-12-25", // Christmas Day
];

// RM per kWh. Two selectable profiles for the dashboard cost estimate:
// - kilang: Medium Voltage ToU (ex-C2/E2) ENERGY charge only. Capacity+network
//   (~RM 97.06 per kW of max demand) are billed separately per month, not per kWh.
// - rumah: Domestic ToU ≤1500 kWh/month, incl. capacity (4.55 sen) + network
//   (12.85 sen) charges; excludes RM10/month retail charge and rebates.
export const TARIFF_PROFILES = {
  kilang: {
    label: "Kilang (MV ToU)",
    peakRm: 0.3132,
    offRm: 0.2723,
    note: "energy charge only — demand charges billed separately",
  },
  rumah: {
    label: "Rumah (Domestic ToU)",
    peakRm: 0.4592,
    offRm: 0.4183,
    note: "incl. capacity + network charges, ≤1500 kWh/month band",
  },
} as const;

export type TariffProfileId = keyof typeof TARIFF_PROFILES;

export function klDateKey(epochSec: number): string {
  const kl = new Date(epochSec * 1000 + KL_OFFSET_MS);
  const m = String(kl.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kl.getUTCDate()).padStart(2, "0");
  return `${kl.getUTCFullYear()}-${m}-${d}`;
}

/** Is a UTC epoch (seconds) inside the KL ToU peak window? */
export function isPeakEpoch(epochSec: number): boolean {
  const kl = new Date(epochSec * 1000 + KL_OFFSET_MS);
  const dow = kl.getUTCDay(); // 0=Sun in KL local terms
  if (dow === 0 || dow === 6) return false;
  if (PUBLIC_HOLIDAYS.includes(klDateKey(epochSec))) return false;
  const h = kl.getUTCHours();
  return h >= PEAK_START_HOUR && h < PEAK_END_HOUR;
}

/** UTC Date of KL midnight `daysAgo` days before today (KL). */
export function klMidnightUtc(daysAgo = 0): Date {
  const kl = new Date(Date.now() + KL_OFFSET_MS);
  return new Date(
    Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth(), kl.getUTCDate() - daysAgo) - KL_OFFSET_MS
  );
}
