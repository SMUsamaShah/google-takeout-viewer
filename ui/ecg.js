// ECG strip view. Draws one reading's waveform as amplitude (raw ADC) vs time (seconds),
// using a dedicated uPlot instance with a non-time x-axis. Vertical gridlines every 0.2 s
// give the familiar ECG time reference; wheel/drag zoom lets you inspect individual beats.
// (No mV calibration is in the export, so the y-axis is raw ADC counts.)

let chart = null;

export function renderECG(container, reading) {
  if (chart) { chart.destroy(); chart = null; }
  container.innerHTML = '';

  const n = reading.samples.length;
  const xs = new Float64Array(n);
  const dt = 1 / reading.sampleRate;
  for (let i = 0; i < n; i++) xs[i] = i * dt;

  const css = getComputedStyle(document.documentElement);
  const pick = (k, f) => css.getPropertyValue(k).trim() || f;
  const trace = pick('--critical', '#c1121f');
  const grid = pick('--grid', '#f0d5d5');
  const ink = pick('--muted', '#666');

  const opts = {
    // Themed from the page's custom properties (canvas can't read `var(--x)`), so the trace
    // follows light/dark like the rest of the UI. Red is right *here*: this is a clinical
    // waveform, the one place the reserved status hue actually means what it says.
    width: container.clientWidth,
    height: Math.max(320, container.clientHeight || 420),
    scales: { x: { time: false } },
    series: [
      { label: 't' },
      { label: 'ECG (raw)', stroke: trace, width: 1, points: { show: false } },
    ],
    axes: [
      { stroke: ink, grid: { stroke: grid }, space: 40, font: '11px system-ui, sans-serif',
        values: (u, ts) => ts.map((t) => t.toFixed(1) + 's') },
      // Amplitude runs to ±4000 ADC counts, so the axis needs room for a 6-character
      // "-2,500" — at uPlot's default width the leading minus is clipped off and negative
      // values read as positive ones.
      { stroke: ink, grid: { stroke: grid }, size: 64, font: '11px system-ui, sans-serif' },
    ],
    cursor: { drag: { x: true, y: false } },
  };

  chart = new uPlot(opts, [xs, reading.samples], container);
  addWheelZoom(chart, xs);
  return chart;
}

export function resizeECG(container) {
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
    u.setScale('x', { min: xVal - (xVal - min) * factor, max: xVal + (max - xVal) * factor });
  }, { passive: false });
  u.over.addEventListener('dblclick', () => u.setScale('x', full));
}
