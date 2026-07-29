// Headline numbers for the visible window, plus the daily table view.
//
// The lead number is RESTING heart rate, not average: it's the one that tracks how the
// heart itself is doing rather than how busy the day was, and it's what changes slowly
// enough for "vs six months ago" to mean something. We use the daily minimum as the
// resting proxy (the export has no explicit resting-HR field in Fit; the Google Health
// sleep files carry a real one when that part of the Takeout is present).
//
// Every tile is scoped to the current timeline window, and the delta compares that window
// with the equally-long window immediately before it — so "Month" reads as this month vs
// last month. For resting HR a fall is an improvement, so the delta's good/bad direction
// is inverted relative to a normal "up is good" metric.

const DAY = 86400;

export function renderStats(host, { daily, hr, win }) {
  host.innerHTML = '';
  if (!daily && !hr) return;

  const span = win.max - win.min;
  const cur = dailyStats(daily, win.min, win.max);
  const prev = dailyStats(daily, win.min - span, win.min);
  const raw = rawStats(hr, win.min, win.max);

  const tiles = [];

  tiles.push(tile({
    k: 'Resting heart rate',
    v: cur.restAvg == null ? '—' : Math.round(cur.restAvg),
    unit: 'bpm',
    delta: deltaOf(cur.restAvg, prev.restAvg, true),
    note: cur.restAvg == null ? 'no daily data in view' : `${cur.days} day${cur.days === 1 ? '' : 's'} in view`,
  }));

  tiles.push(tile({
    k: 'Average',
    v: raw.avg != null ? Math.round(raw.avg) : (cur.avgAvg == null ? '—' : Math.round(cur.avgAvg)),
    unit: 'bpm',
    note: raw.n ? `${fmtCount(raw.n)} samples` : 'from daily summary',
  }));

  tiles.push(tile({
    k: 'Peak',
    v: raw.max != null ? Math.round(raw.max) : (cur.maxMax == null ? '—' : Math.round(cur.maxMax)),
    unit: 'bpm',
    note: raw.max != null && raw.maxT ? whenShort(raw.maxT) : 'highest in view',
  }));

  // Sampling resolution is the reason this viewer exists (the phone app shows 5-minute
  // aggregates), so surface it: it tells you how much detail the window actually holds.
  tiles.push(tile({
    k: 'Resolution',
    v: raw.medGap == null ? '—' : fmtGap(raw.medGap),
    unit: '',
    note: raw.medGap == null ? 'no raw samples in view' : 'median between samples',
  }));

  for (const t of tiles) host.appendChild(t);
}

function tile({ k, v, unit, delta, note }) {
  const el = document.createElement('div');
  el.className = 'tile';
  const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k;
  const vv = document.createElement('div'); vv.className = 'v';
  vv.append(document.createTextNode(String(v)));
  if (unit) { const s = document.createElement('small'); s.textContent = unit; vv.appendChild(s); }
  el.append(kk, vv);
  const d = document.createElement('div'); d.className = 'd';
  if (delta && delta.text) { d.classList.add(delta.dir); d.textContent = delta.text; }
  else d.textContent = note || '';
  el.appendChild(d);
  return el;
}

// lowerIsBetter: for resting HR a drop is the good direction.
function deltaOf(cur, prev, lowerIsBetter) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return { text: 'no change vs previous period', dir: '' };
  const better = lowerIsBetter ? d < 0 : d > 0;
  const arrow = d > 0 ? '▲' : '▼';
  return { text: `${arrow} ${Math.abs(d).toFixed(1)} bpm vs previous period`, dir: better ? 'down' : 'up' };
}

function dailyStats(daily, min, max) {
  const out = { restAvg: null, avgAvg: null, maxMax: null, days: 0 };
  if (!daily?.xs?.length) return out;
  let rs = 0, as = 0, n = 0, mx = -Infinity;
  for (let i = 0; i < daily.xs.length; i++) {
    const t = daily.xs[i];
    if (t < min || t > max) continue;
    const lo = daily.lo?.[i], av = daily.ys?.[i], hi = daily.hi?.[i];
    if (av == null || !Number.isFinite(av)) continue;
    n++; as += av;
    if (Number.isFinite(lo)) rs += lo;
    if (Number.isFinite(hi)) mx = Math.max(mx, hi);
  }
  if (!n) return out;
  out.days = n; out.restAvg = rs / n; out.avgAvg = as / n;
  out.maxMax = mx > -Infinity ? mx : null;
  return out;
}

function rawStats(hr, min, max) {
  const out = { avg: null, max: null, maxT: null, n: 0, medGap: null };
  if (!hr?.xs?.length) return out;
  const xs = hr.xs, ys = hr.ys;
  let i = lowerBound(xs, min);
  let sum = 0, n = 0, mx = -Infinity, mxT = null;
  const gaps = [];
  let prevT = null;
  for (; i < xs.length && xs[i] <= max; i++) {
    const v = ys[i];
    if (!Number.isFinite(v)) continue;
    sum += v; n++;
    if (v > mx) { mx = v; mxT = xs[i]; }
    if (prevT != null) { const g = xs[i] - prevT; if (g > 0 && g < 3600) gaps.push(g); }
    prevT = xs[i];
  }
  if (!n) return out;
  out.avg = sum / n; out.max = mx; out.maxT = mxT; out.n = n;
  if (gaps.length) { gaps.sort((a, b) => a - b); out.medGap = gaps[gaps.length >> 1]; }
  return out;
}

function lowerBound(xs, t) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

// ---- table view (the accessibility twin of the heart-rate lane) ------------------
export function renderTable(wrap, daily, win) {
  const thead = wrap.querySelector('thead'), tbody = wrap.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  const hr = document.createElement('tr');
  for (const h of ['Date', 'Resting (min)', 'Average', 'Peak (max)']) {
    const th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
  }
  thead.appendChild(hr);
  if (!daily?.xs?.length) return;
  const rows = [];
  for (let i = daily.xs.length - 1; i >= 0; i--) {
    const t = daily.xs[i];
    if (t < win.min || t > win.max) continue;
    if (!Number.isFinite(daily.ys?.[i])) continue;
    rows.push([dateStr(t), daily.lo?.[i], daily.ys[i], daily.hi?.[i]]);
    if (rows.length >= 400) break;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    r.forEach((c, ci) => {
      const td = document.createElement('td');
      td.textContent = ci === 0 ? c : (Number.isFinite(c) ? Math.round(c) : '—');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 4; td.textContent = 'No daily heart-rate summary in this range.';
    td.style.color = 'var(--muted)'; tr.appendChild(td); tbody.appendChild(tr);
  }
}

const fmtCount = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const fmtGap = (s) => s < 1 ? `${Math.round(s * 1000)} ms` : s < 90 ? `${s < 10 ? s.toFixed(1).replace(/\.0$/, '') : Math.round(s)} s` : `${Math.round(s / 60)} min`;
const dateStr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const whenShort = (t) => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
