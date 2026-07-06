// Aligns N series (each with its own sorted xs) onto one shared timeline for uPlot,
// which requires all series to share a single x array. We take the union of every
// series' timestamps and fill each series' values into that timeline, leaving NaN
// where a series has no sample at that instant (uPlot renders NaN as a gap).
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

  // 2. For each series, two-pointer fill into an aligned column (NaN = gap).
  const columns = [];
  for (const s of seriesList) {
    const col = new Float64Array(n);
    col.fill(NaN);
    let i = 0;
    const sx = s.xs, sy = s.ys, len = sx.length;
    for (let j = 0; j < n; j++) {
      const t = timeline[j];
      while (i < len && sx[i] < t) i++;      // skip stragglers / duplicates
      if (i < len && sx[i] === t) { col[j] = sy[i]; i++; }
    }
    columns.push(col);
  }

  return { xs: timeline, columns };
}
