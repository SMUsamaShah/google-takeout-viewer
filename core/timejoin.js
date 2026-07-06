// Time-join. GPS points and scalar values (heart rate, speed, ...) never share timestamps
// in this export, so to colour a track by a value we look up, for each track timestamp, the
// nearest sample in a Series. Series.xs is ascending, so this is a binary search.
//
// `maxGapSec` guards against joining across large holes (e.g. a GPS track that predates the
// heart-rate data, or a gap between activities): if the nearest sample is further away than
// the gap, we return NaN so that point is left uncoloured rather than silently wrong.

function nearestIndex(xs, t) {
  let lo = 0, hi = xs.length - 1;
  if (t <= xs[0]) return 0;
  if (t >= xs[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is first index with xs[lo] >= t; compare it with lo-1 for the nearer one.
  return (xs[lo] - t) < (t - xs[lo - 1]) ? lo : lo - 1;
}

// Returns a Float64Array of length track.t, each the joined value (or NaN if beyond maxGapSec).
export function joinValues(trackT, series, maxGapSec = 120) {
  const out = new Float64Array(trackT.length);
  const xs = series.xs, ys = series.ys;
  if (xs.length === 0) { out.fill(NaN); return out; }
  for (let i = 0; i < trackT.length; i++) {
    const t = trackT[i];
    const j = nearestIndex(xs, t);
    out[i] = Math.abs(xs[j] - t) <= maxGapSec ? ys[j] : NaN;
  }
  return out;
}
