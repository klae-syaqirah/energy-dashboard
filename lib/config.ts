// Tariff / peak-window settings. Malaysia has no DST, so a fixed UTC+8 offset is safe.
export const KL_OFFSET_MS = 8 * 3600 * 1000;

export const PEAK_START_HOUR = 8; // 08:00 KL
export const PEAK_END_HOUR = 22; // 22:00 KL
export const PEAK_WEEKDAYS_ONLY = true;

export const TARIFF_RM_PER_KWH = Number(process.env.TARIFF_RM_PER_KWH ?? "0.365");

/** Is a UTC epoch (seconds) inside the KL peak-tariff window? */
export function isPeakEpoch(epochSec: number): boolean {
  const kl = new Date(epochSec * 1000 + KL_OFFSET_MS);
  const dow = kl.getUTCDay(); // 0=Sun in KL local terms
  if (PEAK_WEEKDAYS_ONLY && (dow === 0 || dow === 6)) return false;
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
