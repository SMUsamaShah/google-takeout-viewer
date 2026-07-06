// uPlot wrapper. Takes the aligned {xs, columns} timeline and a matching seriesList,
// draws one line per series. Series with different units (bpm vs m/s) get their own y
// scale + axis (otherwise speed would flatten against the heart-rate range).
//
// Zoom: drag-select (uPlot built-in) and wheel-to-cursor both narrow the x-range;
// double-click resets to full range. Because we feed raw points and never aggregate,
// zooming in reveals the original samples directly.

import { align } from '../core/align.js';

const PALETTE = ['#d1495b', '#2e86ab', '#0a8754', '#e07a1f', '#7b2cbf', '#00a8a8'];
// uPlot axis sides: 1 = right, 3 = left.
const SIDES = [3, 1];

let chart = null;

export function renderChart(container, seriesList) {
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
      spanGaps: false,
      points: { show: false },
    });
  });

  const axes = [{ stroke: '#666', grid: { stroke: '#eee' } }];
  units.forEach((u, i) => {
    axes.push({
      scale: u,
      side: SIDES[i % SIDES.length],
      stroke: '#666',
      grid: { show: i === 0, stroke: '#eee' },
    });
  });

  const opts = {
    width: container.clientWidth,
    height: Math.max(360, container.clientHeight || 480),
    series,
    axes,
    cursor: { drag: { x: true, y: false } },
    scales: { x: { time: true } },
  };

  chart = new uPlot(opts, data, container);
  addWheelZoom(chart, xs);
  return chart;
}

export function resizeChart(container) {
  if (chart) chart.setSize({ width: container.clientWidth, height: chart.height });
}

function addWheelZoom(u, xs) {
  const full = { min: xs[0], max: xs[xs.length - 1] };
  u.over.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = u.over.getBoundingClientRect();
    const xVal = u.posToVal(e.clientX - rect.left, 'x');
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const min = u.scales.x.min, max = u.scales.x.max;
    u.setScale('x', {
      min: xVal - (xVal - min) * factor,
      max: xVal + (max - xVal) * factor,
    });
  }, { passive: false });
  u.over.addEventListener('dblclick', () => u.setScale('x', full));
}
