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

let chart = null;

export function renderChart(container, seriesList, markers = [], onMarkerClick = null) {
  if (chart) { chart.destroy(); chart = null; }
  container.innerHTML = '';
  if (seriesList.length === 0) return null;

  const { xs, columns } = align(seriesList);
  const data = [xs, ...columns];

  const units = [];
  for (const s of seriesList) {
    const u = s.unit || 'value';
    if (!units.includes(u)) units.push(u);
  }

  const series = [{}];
  seriesList.forEach((s, i) => {
    series.push({
      label: s.unit ? `${s.label} (${s.unit})` : s.label,
      scale: s.unit || 'value',
      stroke: PALETTE[i % PALETTE.length],
      width: 1,
      spanGaps: true,
      points: { show: false },
    });
  });

  const axes = [{ stroke: '#666', grid: { stroke: '#eee' } }];
  units.forEach((u, i) => {
    axes.push({ scale: u, side: SIDES[i % SIDES.length], stroke: '#666', grid: { show: i === 0, stroke: '#eee' } });
  });

  const opts = {
    width: container.clientWidth,
    height: Math.max(360, container.clientHeight || 480),
    series,
    axes,
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

export function resizeChart(container) {
  if (chart) chart.setSize({ width: container.clientWidth, height: chart.height });
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
