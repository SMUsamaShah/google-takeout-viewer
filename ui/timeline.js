// The aggregate timeline: one lane per metric, stacked on a single shared time axis.
//
// Why lanes instead of one overlaid chart: overlaying metrics of different units forced a
// second y-axis, and a dual-axis chart invents a correlation that isn't in the data (the
// alignment of the two scales is arbitrary). Small multiples — one lane, one metric, one
// scale, one shared x — say the same thing honestly, and they match how this data is
// actually read: "what was happening at 3pm" is a vertical slice through every lane.
//
// It also removes a structural problem. Previously every selected metric was padded onto
// one union timeline, so heart rate carried a null at each of steps' timestamps. Here each
// lane owns its own x array, so no metric is diluted by another's sample times.
//
// Lanes stay locked to one window: pan/zoom on any lane drives them all, and one crosshair
// tracks every lane at once (uPlot cursor sync), so a moment reads straight down the stack.

import { align } from '../core/align.js';

const AXIS_W = 54;               // fixed left gutter so every lane's plot area lines up
const SYNC = uPlot.sync('health-timeline');

let inst = null; // the live timeline (only one at a time)

export function renderTimeline(container, opts) {
  destroyTimeline();
  container.innerHTML = '';

  const { lanes = [], activities = [], ecgs = [], onHover, onPick } = opts;
  if (lanes.length === 0 && activities.length === 0) {
    container.innerHTML = '<div class="empty-note">No metrics selected. Pick one above to plot it.</div>';
    return null;
  }

  const extent = fullExtent(lanes, activities);
  const plots = [];
  const laneNowEls = [];
  let win = { min: extent.min, max: extent.max };
  let applying = false; // guards the setScale fan-out from re-entering

  const setWindow = (min, max) => {
    if (max - min < 60) return;              // floor the zoom at one minute
    min = Math.max(min, extent.min - 1);
    max = Math.min(max, extent.max + 1);
    win = { min, max };
    applying = true;
    for (const p of plots) p.setScale('x', { min, max });
    applying = false;
    updateLaneCoverage();
    drawRibbon();
    if (opts.onRange) opts.onRange(min, max);
  };

  // ---- metric lanes ----------------------------------------------------------
  lanes.forEach((lane, li) => {
    const el = document.createElement('div');
    el.className = 'lane';
    el.innerHTML =
      `<div class="lane-head">
         <span class="lane-title"><i class="key" style="background:${lane.color}"></i>${escapeHtml(lane.label)}</span>
         <span class="lane-unit">${escapeHtml(lane.unit || '')}</span>
         <span class="lane-now" data-now></span>
       </div>
       <div class="lane-plot"></div>`;
    container.appendChild(el);

    const host = el.querySelector('.lane-plot');
    laneNowEls.push(el.querySelector('[data-now]'));
    const isLast = li === lanes.length - 1 && activities.length === 0 && ecgs.length === 0;
    const p = buildLanePlot(host, lane, win, isLast, {
      onHover: (t, vals) => { report(t, vals, li); },
      setWindow,
      extent,
      onPick,
    });
    plots.push(p);
  });

  // ---- activity ribbon lane ---------------------------------------------------
  // The ribbon is a uPlot too, drawn in a hook rather than as a series. That buys exact
  // x-alignment with the metric lanes, the shared cursor, pan/zoom, and — the reason it
  // isn't a bare canvas — the one visible time axis for the whole stack.
  let ribbonNow = null;
  if (activities.length || ecgs.length) {
    const el = document.createElement('div');
    el.className = 'lane';
    el.innerHTML =
      `<div class="lane-head">
         <span class="lane-title"><i class="key" style="background:var(--s3)"></i>Recorded activities</span>
         <span class="lane-unit">${activities.length} recorded${ecgs.length ? ` · ${ecgs.length} ECG` : ''}</span>
         <span class="lane-now" data-now></span>
       </div>
       <div class="lane-plot"></div>`;
    container.appendChild(el);
    ribbonNow = el.querySelector('[data-now]');
    plots.push(buildRibbonPlot(el.querySelector('.lane-plot'), activities, ecgs, win, {
      onHover: (t) => report(t, null, -1),
      setWindow, extent, onPick,
    }));
  } else if (plots.length) {
    // No ribbon: the last metric lane carries the axis (handled by its showXAxis flag).
  }

  function drawRibbon() { /* the ribbon plot redraws itself on scale change */ }

  function updateLaneCoverage() {
    lanes.forEach((lane, i) => {
      const count = countInRange(lane.series.xs, win.min, win.max);
      laneNowEls[i].textContent = count ? `${count.toLocaleString()} samples` : 'No samples in this window';
      laneNowEls[i].classList.toggle('no-data', !count);
    });
  }

  // ---- shared hover readout ----------------------------------------------------
  function report(t, _vals, fromLane) {
    if (!Number.isFinite(t)) return;
    // Each lane shows its own value at the cursor; the inspector gets the whole slice.
    lanes.forEach((lane, i) => {
      const nowEl = container.querySelectorAll('.lane')[i]?.querySelector('[data-now]');
      if (!nowEl) return;
      const v = sampleAt(lane.series, t);
      nowEl.textContent = v == null ? '—' : `${fmtVal(v)} ${lane.unit || ''}`.trim();
    });
    if (ribbonNow) {
      const a = activities.find((a) => t >= a.t && t <= a.t + Math.max(a.dur || 0, 30));
      ribbonNow.textContent = a ? `${a.sport}${a.dur ? ` · ${Math.round(a.dur / 60)}m` : ''}` : '';
    }
    if (onHover) onHover(t);
  }

  // ---- resize ------------------------------------------------------------------
  const onResize = () => {
    const w = container.clientWidth;
    for (const p of plots) p.setSize({ width: Math.max(240, w - 12), height: p.height });
    drawRibbon();
  };
  window.addEventListener('resize', onResize);

  updateLaneCoverage();
  requestAnimationFrame(() => { onResize(); drawRibbon(); });

  inst = {
    setWindow,
    getWindow: () => ({ ...win }),
    extent,
    redrawRibbon: drawRibbon,
    destroy() {
      window.removeEventListener('resize', onResize);
      for (const p of plots) p.destroy();
      plots.length = 0;
    },
  };
  return inst;
}

export function destroyTimeline() {
  if (inst) { inst.destroy(); inst = null; }
}

export function timeline() { return inst; }

function countInRange(xs, min, max) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < min) lo = m + 1; else hi = m; }
  const first = lo;
  hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= max) lo = m + 1; else hi = m; }
  return lo - first;
}

// ---- one lane ------------------------------------------------------------------
function buildLanePlot(host, lane, win, showXAxis, hooks) {
  // Band + raw share this lane's own x array (only this lane's series are unioned, so no
  // other metric's timestamps dilute it).
  const parts = lane.band ? [lane.band, lane.series] : [lane.series];
  const { xs, columns, loColumns, hiColumns } = align(parts);

  const data = [xs];
  const series = [{}];
  const bands = [];
  // uPlot paints to canvas, where `var(--x)` means nothing — resolve every colour to a
  // literal before it reaches a stroke/fill.
  const bandColor = cssColor('--band', 'rgba(42,120,214,0.14)');
  const inkMuted = cssColor('--muted', '#898781');
  const gridCol = cssColor('--grid', '#e1e0d9');
  const laneColor = resolveColor(lane.color, '#2a78d6');

  if (lane.band) {
    const marks = markIndices(loColumns[0]);
    const lo = fillBandStep(xs, loColumns[0], marks);
    const hi = fillBandStep(xs, hiColumns[0], marks);
    const loIdx = data.push(lo) - 1;
    series.push({ scale: 'y', stroke: 'transparent', width: 0, spanGaps: false, points: { show: false } });
    const hiIdx = data.push(hi) - 1;
    series.push({ scale: 'y', stroke: 'transparent', width: 0, spanGaps: false, points: { show: false } });
    bands.push({ series: [hiIdx, loIdx], fill: bandColor });
  }
  data.push(columns[lane.band ? 1 : 0]);
  series.push({
    scale: 'y', stroke: laneColor, width: lane.hero ? 1.25 : 1,
    spanGaps: false, points: { show: false },
  });

  const opts = {
    width: Math.max(240, host.clientWidth || 600),
    height: lane.height || 130,
    series,
    bands,
    legend: { show: false },
    padding: [6, 8, showXAxis ? 0 : 2, 0],
    scales: { x: { time: true, min: win.min, max: win.max }, y: { auto: true } },
    axes: [
      {
        show: showXAxis, stroke: inkMuted, size: showXAxis ? 30 : 0,
        grid: { stroke: gridCol, width: 1 }, ticks: { stroke: gridCol, size: 4 },
        font: '11px system-ui, sans-serif',
      },
      {
        scale: 'y', size: AXIS_W, stroke: inkMuted,
        grid: { stroke: gridCol, width: 1 }, ticks: { show: false },
        font: '11px system-ui, sans-serif',
        splits: (u, _a, min, max) => niceSplits(min, max),
      },
    ],
    cursor: {
      sync: { key: SYNC.key, setSeries: false },
      drag: { x: true, y: false },
      bind: { mousedown: (u, t, handler) => (e) => { if (e.shiftKey) handler(e); } },
      points: { show: false },
    },
    hooks: {
      setCursor: [(u) => {
        // Only report a cursor that is actually over the plot area — off to the side (the
        // axis gutter, or a stale position after a re-layout) would otherwise read out a
        // time outside the visible window and look like "no data".
        const L = u.cursor.left;
        if (L == null || L < 0 || L > u.over.clientWidth) return;
        const t = u.posToVal(L, 'x');
        if (Number.isFinite(t)) hooks.onHover(t);
      }],
    },
  };

  const u = new uPlot(opts, data, host);
  addPanZoom(u, hooks.setWindow, hooks.extent, hooks.onPick);
  return u;
}

// The activity/ECG ribbon: an axis-bearing uPlot whose marks are painted in a draw hook.
function buildRibbonPlot(host, activities, ecgs, win, hooks) {
  const inkMuted = cssColor('--muted', '#898781');
  const gridCol = cssColor('--grid', '#e1e0d9');
  const actCol = cssColor('--s3', '#1baf7a');
  const ecgCol = cssColor('--critical', '#d03b3b');

  const data = [[win.min, win.max], [null, null]];

  const u = new uPlot({
    width: Math.max(240, host.clientWidth || 600),
    height: 76,
    series: [{}, { scale: 'y', stroke: 'transparent', points: { show: false } }],
    legend: { show: false },
    padding: [4, 8, 0, 0],
    scales: { x: { time: true, min: win.min, max: win.max }, y: { auto: false, range: [0, 1] } },
    axes: [
      {
        show: true, stroke: inkMuted, size: 30,
        grid: { stroke: gridCol, width: 1 }, ticks: { stroke: gridCol, size: 4 },
        font: '11px system-ui, sans-serif',
      },
      { scale: 'y', size: AXIS_W, show: false, grid: { show: false }, ticks: { show: false } },
    ],
    cursor: {
      sync: { key: SYNC.key, setSeries: false },
      drag: { x: true, y: false },
      bind: { mousedown: (u2, t, handler) => (e) => { if (e.shiftKey) handler(e); } },
      points: { show: false },
    },
    hooks: {
      setCursor: [(u2) => {
        const L = u2.cursor.left;
        if (L == null || L < 0 || L > u2.over.clientWidth) return;
        const t = u2.posToVal(L, 'x');
        if (Number.isFinite(t)) hooks.onHover(t);
      }],
      draw: [(u2) => {
        const ctx = u2.ctx, r = u2.pxRatio || 1;
        const { left, top, width, height } = u2.bbox;
        ctx.save();
        ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
        // Activity blocks. A sub-pixel activity still gets a 2px mark, so a zoomed-out
        // year doesn't silently hide every walk.
        ctx.fillStyle = actCol;
        for (const a of activities) {
          const x0 = u2.valToPos(a.t, 'x', true);
          const x1 = u2.valToPos(a.t + Math.max(a.dur || 0, 30), 'x', true);
          if (x1 < left || x0 > left + width) continue;
          roundRect(ctx, x0, top + 6 * r, Math.max(2 * r, x1 - x0), 18 * r, 3 * r);
          ctx.fill();
        }
        // ECG readings in the reserved status colour — these are the events that can
        // actually matter clinically, so they get the status hue, never a series one.
        ctx.fillStyle = ecgCol;
        for (const e of ecgs) {
          const x = u2.valToPos(e.t, 'x', true);
          if (x < left || x > left + width) continue;
          roundRect(ctx, x - 1.25 * r, top + 30 * r, 2.5 * r, 11 * r, 1.25 * r);
          ctx.fill();
        }
        ctx.restore();
      }],
    },
  }, data, host);

  // Hit-testing: the ribbon's marks are clickable, everything else pins the moment.
  const hitAt = (px, py) => {
    const t = u.posToVal(px, 'x');
    const tol = ((u.scales.x.max - u.scales.x.min) / Math.max(1, u.over.clientWidth)) * 6;
    if (py >= 26) {
      let best = null, bd = tol * 2;
      for (const e of ecgs) { const d = Math.abs(e.t - t); if (d < bd) { bd = d; best = e; } }
      if (best) return { kind: 'ecg', ref: best.ref, label: 'ECG reading', t: best.t };
    }
    for (const a of activities) {
      if (t >= a.t - tol && t <= a.t + Math.max(a.dur || 0, 30) + tol) {
        return { kind: 'activity', ref: a.ref, label: a.sport, t: a.t, dur: a.dur };
      }
    }
    return null;
  };
  u.over.addEventListener('pointermove', (e) => {
    const rect = u.over.getBoundingClientRect();
    u.over.style.cursor = hitAt(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'grab';
  });
  addPanZoom(u, hooks.setWindow, hooks.extent, (pick) => {
    const rect = u.over.getBoundingClientRect();
    const hit = pick.clientX != null ? hitAt(pick.clientX - rect.left, pick.clientY - rect.top) : null;
    hooks.onPick?.({ t: pick.t, event: hit });
  });
  return u;
}

// Drag pans, wheel zooms at the cursor, shift+drag selects, double-click resets — all
// routed through the shared setWindow so every lane moves together.
function addPanZoom(u, setWindow, extent, onPick) {
  let panning = false, startPx = 0, s0 = 0, s1 = 0, moved = false;
  u.over.style.cursor = 'grab';

  u.over.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.shiftKey) return;
    panning = true; moved = false;
    startPx = e.clientX; s0 = u.scales.x.min; s1 = u.scales.x.max;
    u.over.setPointerCapture(e.pointerId);
    u.over.style.cursor = 'grabbing';
  });
  u.over.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dx = e.clientX - startPx;
    if (Math.abs(dx) > 3) moved = true;
    const width = s1 - s0;
    const dv = dx * (width / u.over.clientWidth);
    setWindow(s0 - dv, s1 - dv);
  });
  const end = (e) => {
    if (!panning) return;
    panning = false;
    if (u.over.hasPointerCapture?.(e.pointerId)) u.over.releasePointerCapture(e.pointerId);
    u.over.style.cursor = 'grab';
  };
  u.over.addEventListener('pointerup', end);
  u.over.addEventListener('pointercancel', end);

  u.over.addEventListener('click', (e) => {
    if (moved || !onPick) return;
    const rect = u.over.getBoundingClientRect();
    const t = u.posToVal(e.clientX - rect.left, 'x');
    // clientX/Y ride along so a lane that has clickable marks (the ribbon) can hit-test.
    if (Number.isFinite(t)) onPick({ t, event: null, clientX: e.clientX, clientY: e.clientY });
  });

  u.over.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = u.over.getBoundingClientRect();
    const t = u.posToVal(e.clientX - rect.left, 'x');
    const f = e.deltaY < 0 ? 0.8 : 1.25;
    setWindow(t - (t - u.scales.x.min) * f, t + (u.scales.x.max - t) * f);
  }, { passive: false });

  u.over.addEventListener('dblclick', () => setWindow(extent.min, extent.max));

  // uPlot's own drag-select (shift+drag) zooms to the selection across all lanes.
  u.hooks.setSelect = u.hooks.setSelect || [];
  u.hooks.setSelect.push(() => {
    if (u.select.width <= 0) return;
    const a = u.posToVal(u.select.left, 'x');
    const b = u.posToVal(u.select.left + u.select.width, 'x');
    u.setSelect({ width: 0, height: 0 }, false);
    setWindow(a, b);
  });
}

// ---- helpers --------------------------------------------------------------------
function fullExtent(lanes, activities) {
  let min = Infinity, max = -Infinity;
  for (const l of lanes) {
    const s = l.series;
    if (s?.xs?.length) { min = Math.min(min, s.xs[0]); max = Math.max(max, s.xs[s.xs.length - 1]); }
    if (l.band?.xs?.length) { min = Math.min(min, l.band.xs[0]); max = Math.max(max, l.band.xs[l.band.xs.length - 1]); }
  }
  for (const a of activities) { min = Math.min(min, a.t); max = Math.max(max, a.t + (a.dur || 0)); }
  if (!Number.isFinite(min)) { const now = Date.now() / 1000; return { min: now - 86400, max: now }; }
  if (max - min < 3600) max = min + 3600;
  return { min, max };
}

// Nearest sample to t, or null when the nearest is further than the series' own typical
// spacing allows (so a gap reads as "no data" rather than a stale value).
export function sampleAt(series, t, maxGapSec = null) {
  const xs = series?.xs, ys = series?.ys;
  if (!xs || xs.length === 0) return null;
  let lo = 0, hi = xs.length - 1;
  if (t <= xs[0]) { return within(xs[0]) ? ys[0] : null; }
  if (t >= xs[hi]) { return within(xs[hi]) ? ys[hi] : null; }
  while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m] < t) lo = m + 1; else hi = m - 1; }
  const j = (xs[lo] - t) < (t - xs[lo - 1]) ? lo : lo - 1;
  return within(xs[j]) ? ys[j] : null;
  function within(x) {
    const tol = maxGapSec ?? 900; // 15 min: beyond that the watch simply wasn't sampling
    return Math.abs(x - t) <= tol;
  }
}

// A daily value describes a whole day, so it is held flat ACROSS that day (a step), never
// interpolated toward the next day's value. Interpolating drew a smooth envelope that, zoomed
// into a two-day window, became a big triangle implying a trend within the day that the daily
// summary simply doesn't contain. Each mark sits at midday, so filling ±12h paints one block
// per day: consecutive days abut into a continuous band, and a missing day leaves a real
// 24-hour hole that breaks it — no extra gap threshold needed.
function fillBandStep(xs, sparse, marks) {
  const n = xs.length;
  const out = new Array(n).fill(null);
  if (!marks.length) return out;
  let m = 0;
  for (let k = 0; k < n; k++) {
    const t = xs[k];
    while (m < marks.length - 1 && Math.abs(xs[marks[m + 1]] - t) < Math.abs(xs[marks[m]] - t)) m++;
    const j = marks[m];
    if (Math.abs(xs[j] - t) <= 12 * 3600) out[k] = sparse[j];
  }
  return out;
}

// Indices of the timeline points that carry a daily value.
function markIndices(sparse) {
  const out = [];
  for (let i = 0; i < sparse.length; i++) if (sparse[i] != null) out.push(i);
  return out;
}

function niceSplits(min, max) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const step = Math.pow(10, Math.floor(Math.log10(span / 3)));
  const mult = span / 3 / step;
  const s = step * (mult >= 5 ? 5 : mult >= 2 ? 2 : 1);
  const out = [];
  for (let v = Math.ceil(min / s) * s; v <= max; v += s) out.push(+v.toFixed(6));
  return out.length ? out : [min, max];
}

// Canvas needs literal colours. Read a CSS custom property off :root, with a fallback for
// the case where styles haven't applied yet.
export function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
// Accepts either a literal colour or a `var(--token)` reference and always returns a literal.
export function resolveColor(c, fallback) {
  if (!c) return fallback;
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(String(c).trim());
  return m ? cssColor(m[1], fallback) : c;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fmtVal(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 100 ? String(Math.round(v)) : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
