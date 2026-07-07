// Parser for the combined Google Fit daily summary:
//   Takeout/Fit/Daily activity metrics/Daily activity metrics.csv
//
// One row per calendar day (2015-… here), with columns including
//   Date, Average heart rate (bpm), Max heart rate (bpm), Min heart rate (bpm), ...
//
// The per-day min/avg/max heart rate is the cheap "how is my heart doing over months"
// signal: a few hundred daily points instead of the ~400k raw samples, so it renders
// the whole history at a glance. We surface it as a single band series — a min→max
// shaded band with the daily average as its centre line (see chart.js band support) —
// so the long-term trend and its daily spread read together. Daily min heart rate is a
// decent resting-HR proxy and is usually the most informative line of the three.
//
// Raw per-sample heart rate still lives in fit-datapoints.js; this is the overview layer.

import { register } from '../core/registry.js';

export const fitDailyParser = {
  match(name) {
    return name === 'Daily activity metrics.csv';
  },

  // Returns a single band Series: { xs, ys(avg), lo(min), hi(max), band:true }.
  // Days without heart-rate data are skipped entirely (not charted as gaps).
  parse(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].split(',');
    const col = (name) => header.indexOf(name);
    const iDate = col('Date');
    const iAvg = col('Average heart rate (bpm)');
    const iMin = col('Min heart rate (bpm)');
    const iMax = col('Max heart rate (bpm)');
    if (iDate < 0 || iAvg < 0) return [];

    const xs = [], avg = [], lo = [], hi = [];
    for (let r = 1; r < lines.length; r++) {
      const line = lines[r];
      if (!line) continue;
      const f = line.split(',');
      const a = parseFloat(f[iAvg]);
      if (!Number.isFinite(a)) continue; // no HR that day
      const t = Date.parse(f[iDate] + 'T12:00:00Z'); // mid-day marker for the day
      if (Number.isNaN(t)) continue;
      const mn = iMin >= 0 ? parseFloat(f[iMin]) : NaN;
      const mx = iMax >= 0 ? parseFloat(f[iMax]) : NaN;
      xs.push(t / 1000);
      avg.push(a);
      lo.push(Number.isFinite(mn) ? mn : a);
      hi.push(Number.isFinite(mx) ? mx : a);
    }
    if (xs.length === 0) return [];

    // Insert an explicit null "breaker" in the middle of any gap longer than BREAK_GAP,
    // so the band/line render a real break there instead of one continuous shape across a
    // months-long hole. A breaker guarantees a null timeline point exists in the gap even
    // when the two surrounding days would otherwise be adjacent on the shared axis. ys/lo/hi
    // are plain Arrays (not typed) so the nulls survive alignment. See decisions.md ADR 28.
    const BREAK_GAP = 14 * 86400;
    const X = [], Y = [], LO = [], HI = [];
    for (let i = 0; i < xs.length; i++) {
      if (i > 0 && xs[i] - xs[i - 1] > BREAK_GAP) {
        X.push((xs[i - 1] + xs[i]) / 2); Y.push(null); LO.push(null); HI.push(null);
      }
      X.push(xs[i]); Y.push(avg[i]); LO.push(lo[i]); HI.push(hi[i]);
    }

    return [{
      id: 'daily-hr',
      dataType: 'daily.heart_rate',
      label: 'Daily heart rate',
      unit: 'bpm',
      band: true,
      xs: Float64Array.from(X),
      ys: Y,  // centre line = daily average (plain array; may contain null breakers)
      lo: LO, // daily minimum (resting-HR proxy)
      hi: HI, // daily maximum
    }];
  },
};

register(fitDailyParser);
