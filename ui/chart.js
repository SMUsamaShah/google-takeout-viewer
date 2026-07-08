// uPlot wrapper used as the aggregate timeline. Draws selected metrics as lines on one shared
// time axis, plus optional event markers (activities, ECG) as ticks at the top that can be
// clicked to open that event. Hovering shows every metric's value at that instant (uPlot legend).
//
// spanGaps is TRUE: the shared timeline (core/align.js) pads each series with NaN at the OTHER
// series' timestamps, so with spanGaps:false a second metric would shatter the first into
// thousands of fragments. Bridging those NaNs keeps each line whole. (A genuine long gap is then
// also bridged with a straight segment — a lesser, separate issue noted in decisions.)

import { align } from '../core/align.js';

const PALETTE = ['#d1495b', '#2e86ab', '#0a8754', '#e07a1f', '#7b2cbf', '#00a8a8'];
const SIDES = [3, 1]; // uPlot axis sides: 3 = left, 1 = right
const MARKER_COLORS = { activity: '#2e86ab', ecg: '#c1121f' };
// Daily band (fit-daily): a muted slate envelope so it reads as background context,
// distinct from the vivid raw heart-rate line drawn on top of it.
const BAND_FILL = 'rgba(70, 100, 130, 0.16)';
const BAND_STROKE = '#3a6ea5';
const BAND_MAX_GAP = 14 * 86400; // don't bridge the daily band across gaps wider than 14 days

let chart = null;

export function renderChart(container, seriesList, markers = [], onMarkerClick = null) {
  if (chart) { chart.destroy(); chart = null; }
  container.innerHTML = '';
  if (seriesList.length === 0) return null;

  const { xs, columns, loColumns, hiColumns } = align(seriesList);

  // Build uPlot data + series. Most metrics map 1:1 to a line. A band series (daily HR)
  // expands to three uPlot series — min and max (invisible strokes) plus the average line —
  // with a uPlot `band` filling between min and max. Axes are added once per unit.
  const data = [xs];
  const series = [{}];
  const bands = [];
  const axes = [{ stroke: '#666', grid: { stroke: '#eee' } }];
  const units = [];
  let colorN = 0;

  const ensureAxis = (u) => {
    if (units.includes(u)) return;
    const i = units.push(u) - 1;
    axes.push({ scale: u, side: SIDES[i % SIDES.length], stroke: '#666', grid: { show: i === 0, stroke: '#eee' } });
  };

  seriesList.forEach((s, i) => {
    const unit = s.unit || 'value';
    ensureAxis(unit);

    if (s.band && loColumns[i] && hiColumns[i]) {
      // Daily points sit sparsely on the shared union timeline. Linearly fill min/max/avg
      // between neighbouring days so the band/line stay continuous through the raw-sample
      // gaps between them — but leave a real break (null) wherever consecutive days are more
      // than BAND_MAX_GAP apart, so we don't draw a misleading band across a months-long
      // hole. spanGaps is therefore false for these series (nulls must break, not bridge).
      const lo = fillBandLinear(xs, loColumns[i], BAND_MAX_GAP);
      const hi = fillBandLinear(xs, hiColumns[i], BAND_MAX_GAP);
      const mid = fillBandLinear(xs, columns[i], BAND_MAX_GAP);
      const loIdx = data.push(lo) - 1;
      series.push({ label: `${s.label} min`, scale: unit, stroke: BAND_FILL, width: 0, spanGaps: false, points: { show: false } });
      const hiIdx = data.push(hi) - 1;
      series.push({ label: `${s.label} max`, scale: unit, stroke: BAND_FILL, width: 0, spanGaps: false, points: { show: false } });
      data.push(mid);
      series.push({ label: `${s.label} avg (${unit})`, scale: unit, stroke: BAND_STROKE, width: 1.5, spanGaps: false, points: { show: false } });
      bands.push({ series: [hiIdx, loIdx], fill: BAND_FILL });
    } else {
      data.push(columns[i]);
      series.push({
        label: s.unit ? `${s.label} (${s.unit})` : s.label,
        scale: unit,
        stroke: PALETTE[colorN++ % PALETTE.length],
        width: 1,
        spanGaps: true,
        points: { show: false },
      });
    }
  });

  const opts = {
    width: container.clientWidth,
    height: Math.max(360, container.clientHeight || 480),
    series,
    axes,
    bands,
    cursor: {
      // Plain drag pans the time axis (see addPan). uPlot's own drag draws a zoom
      // selection instead, so gate it to Shift+drag via the mousedown bind below.
      drag: { x: true, y: false },
      bind: { mousedown: (u, targ, handler) => (e) => { if (e.shiftKey) handler(e); } },
    },
    scales: { x: { time: true } },
    hooks: { draw: [(u) => drawMarkers(u, markers)] },
  };

  chart = new uPlot(opts, data, container);
  addWheelZoom(chart, xs);
  addPan(chart, xs);
  if (onMarkerClick) addMarkerClicks(chart, markers, onMarkerClick);
  return chart;
}

// Linearly interpolate a sparse aligned column (non-null only at daily marks) across the
// shared timeline `xs`, so a daily series stays continuous through the raw-sample points
// between days. Neighbouring marks more than `maxGapSec` apart are NOT joined — the span
// between them is left null so the line/band breaks there instead of spanning a real hole.
function fillBandLinear(xs, sparse, maxGapSec) {
  const n = xs.length;
  const out = new Array(n).fill(null);
  let prev = -1; // index of previous mark
  for (let j = 0; j < n; j++) {
    if (sparse[j] == null) continue;
    if (prev >= 0 && xs[j] - xs[prev] <= maxGapSec) {
      const ta = xs[prev], va = sparse[prev], span = xs[j] - ta, dv = sparse[j] - va;
      for (let k = prev; k < j; k++) out[k] = va + dv * ((xs[k] - ta) / span);
    }
    out[j] = sparse[j]; // the mark itself is always drawn
    prev = j;
  }
  return out;
}

export function resizeChart(container) {
  if (chart) chart.setSize({ width: container.clientWidth, height: chart.height });
}

// Set the visible time window (seconds). Used to open on a recent, data-dense range
// instead of the full multi-year span. Clamped to nothing here; pan/zoom handle bounds.
export function zoomChart(min, max) {
  if (chart) chart.setScale('x', { min, max });
}

// Draw each event as a short vertical tick at the top of the plot.
function drawMarkers(u, markers) {
  if (!markers.length) return;
  const ctx = u.ctx;
  const { left, top, width } = u.bbox;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  for (const m of markers) {
    const x = u.valToPos(m.t, 'x', true);
    if (x < left || x > left + width) continue;
    ctx.strokeStyle = MARKER_COLORS[m.kind] || '#888';
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + 14 * (u.pxRatio || 1));
    ctx.stroke();
  }
  ctx.restore();
}

// Click near a marker (in the top band) opens it.
function addMarkerClicks(u, markers, onMarkerClick) {
  u.over.addEventListener('click', (e) => {
    const rect = u.over.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (py > 18) return; // only the marker band at the very top is clickable
    if (u._panned) return; // this "click" was the end of a drag-pan, not a real click
    let best = null, bestD = 6;
    for (const m of markers) {
      const d = Math.abs(u.valToPos(m.t, 'x') - px);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) onMarkerClick(best.ref);
  });
}

// Drag left/right to pan the time axis. Shift+drag is left to uPlot as a zoom selection
// (see the cursor bind), so we ignore it here. Pointer capture keeps the pan tracking even
// when the cursor leaves the plot, and — being bound to u.over — is torn down with the chart
// (no leaked window listeners across re-renders). Panning is clamped to the data extent so
// you can't drag off into empty space and lose the series.
function addPan(u, xs) {
  const full = { min: xs[0], max: xs[xs.length - 1] };
  let panning = false, startPx = 0, startMin = 0, startMax = 0;

  u.over.style.cursor = 'grab';
  u.over.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.shiftKey) return;
    panning = true;
    u._panned = false;
    startPx = e.clientX;
    startMin = u.scales.x.min;
    startMax = u.scales.x.max;
    u.over.setPointerCapture(e.pointerId);
    u.over.style.cursor = 'grabbing';
  });
  u.over.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dxPx = e.clientX - startPx;
    if (Math.abs(dxPx) > 3) u._panned = true;
    const width = startMax - startMin;
    const dv = dxPx * (width / u.over.clientWidth);
    let min = startMin - dv, max = startMax - dv;
    if (min < full.min) { min = full.min; max = min + width; }
    if (max > full.max) { max = full.max; min = max - width; }
    u.setScale('x', { min, max });
  });
  const end = (e) => {
    if (!panning) return;
    panning = false;
    if (u.over.hasPointerCapture(e.pointerId)) u.over.releasePointerCapture(e.pointerId);
    u.over.style.cursor = 'grab';
  };
  u.over.addEventListener('pointerup', end);
  u.over.addEventListener('pointercancel', end);
}

function addWheelZoom(u, xs) {
  const full = { min: xs[0], max: xs[xs.length - 1] };
  u.over.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = u.over.getBoundingClientRect();
    const xVal = u.posToVal(e.clientX - rect.left, 'x');
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const min = u.scales.x.min, max = u.scales.x.max;
    u.setScale('x', { min: xVal - (xVal - min) * factor, max: xVal + (max - xVal) * factor });
  }, { passive: false });
  u.over.addEventListener('dblclick', () => u.setScale('x', full));
}
