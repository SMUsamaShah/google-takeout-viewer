// Aligns N series (each with its own sorted xs) onto one shared timeline for uPlot,
// which requires all series to share a single x array. We take the union of every
// series' timestamps and fill each series' values into that timeline, leaving `null`
// where a series has no sample at that instant (uPlot renders null as a gap).
//
// Gaps MUST be `null`, not `NaN`: uPlot ranges each y-scale by seeding its running
// min/max with the first in-view sample and then comparing the rest. A `NaN` seed
// poisons that scan (`NaN > v` and `v > NaN` are both false, so nothing updates), so
// the scale gets no range and the whole series + its axis vanish — which happens
// whenever a series' first visible sample falls in another series' timestamps (e.g.
// overlaying heart rate, which starts in 2021, with steps that start in 2015) or when
// a zoom window opens on a gap. uPlot's scan skips `null`, so gaps must be null. The
// columns are therefore plain Arrays (a typed array cannot hold null); the raw series
// stay Float64Array. See decisions.md ADR 26 (corrects ADR 9).
//
// Raw values are preserved exactly - no resampling - so zooming in still shows the
// original points. Equality on timestamps is exact because the union is built from
// the very same Float64 values held by the series (identical bit patterns).

export function align(seriesList) {
  if (seriesList.length === 0) return { xs: new Float64Array(0), columns: [] };

  // 1. Union of all timestamps: concat -> numeric sort (TypedArray.sort is numeric) -> dedupe.
  let total = 0;
  for (const s of seriesList) total += s.xs.length;

  const all = new Float64Array(total);
  let o = 0;
  for (const s of seriesList) {
    all.set(s.xs, o);
    o += s.xs.length;
  }
  all.sort();

  // Dedupe in place.
  const xs = new Float64Array(total);
  let n = 0;
  for (let i = 0; i < total; i++) {
    if (n === 0 || all[i] !== xs[n - 1]) xs[n++] = all[i];
  }
  const timeline = xs.subarray(0, n);

  // 2. For each series, two-pointer fill into an aligned column (null = gap). A band
  //    series (fit-daily) also carries parallel `lo`/`hi` arrays (min/max envelope); we
  //    fill those into their own aligned columns, else push null so indices stay lined up.
  const columns = [], loColumns = [], hiColumns = [];
  for (const s of seriesList) {
    const col = new Array(n).fill(null);
    const lo = s.lo ? new Array(n).fill(null) : null;
    const hi = s.hi ? new Array(n).fill(null) : null;
    let i = 0;
    const sx = s.xs, sy = s.ys, len = sx.length;
    for (let j = 0; j < n; j++) {
      const t = timeline[j];
      while (i < len && sx[i] < t) i++;      // skip stragglers / duplicates
      if (i < len && sx[i] === t) {
        col[j] = sy[i];
        if (lo) lo[j] = s.lo[i];
        if (hi) hi[j] = s.hi[i];
        i++;
      }
    }
    columns.push(col);
    loColumns.push(lo);
    hiColumns.push(hi);
  }

  return { xs: timeline, columns, loColumns, hiColumns };
}
