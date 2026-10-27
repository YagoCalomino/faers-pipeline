// Number formatting shown on the pages (en-US). Every number cell also carries the full value
// in data-value, so checks can compare the page with the warehouse without rounding.
//   counts: integers with thousands separators
//   ratios (PRR, ROR, CIs, chi2): 3 significant digits below 1,000, whole numbers from 1,000
//   shares (0..1): whole percent
//   pct metrics (already in percent): 2 significant digits below 10 (0.90%, 2.0%), 1 decimal
//   from 10 (39.5%)
// Intl rounds the exact double half away from zero (ECMA-402 "halfExpand").

export const DASH = '—';

const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const RATIO_SMALL = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });
const RATIO_LARGE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const SHARE = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
const PCT_SMALL = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 2,
});
const PCT_LARGE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const missing = (v) => v === null || v === undefined || Number.isNaN(v);

export function fmtCount(v) {
  return missing(v) ? DASH : COUNT.format(v);
}

export function fmtRatio(v) {
  if (missing(v)) return DASH;
  return Math.abs(v) >= 1000 ? RATIO_LARGE.format(v) : RATIO_SMALL.format(v);
}

export function fmtInterval(lo, hi) {
  if (missing(lo) || missing(hi)) return DASH;
  return `${fmtRatio(lo)} to ${fmtRatio(hi)}`;
}

export function fmtShare(v) {
  return missing(v) ? DASH : SHARE.format(v);
}

// A share that is above 0 but rounds to 0% shows as "<1%".
export function fmtShareMin(v) {
  return !missing(v) && v > 0 && v < 0.005 ? '<1%' : fmtShare(v);
}

export function fmtPct(v) {
  if (missing(v)) return DASH;
  return `${Math.abs(v) >= 10 ? PCT_LARGE.format(v) : PCT_SMALL.format(v)}%`;
}

export function fmtMetric(value, unit) {
  return unit === 'pct' ? fmtPct(value) : fmtCount(value);
}

// Full value for data-value attributes: String() of a double round-trips exactly.
export function rawValue(v) {
  return missing(v) ? '' : String(v);
}
