// Orchestration. One folder load feeds a sidebar organised by what you want to look at,
// not by file format. The main area follows your selection — there are no view tabs:
//   tick a metric  -> chart (overlay-able, zoomable)
//   click activity -> map of that GPS track, coloured by a chosen metric
//   click ECG      -> that reading's waveform
//
// The sidebar lists ONE row per metric (not one per file): several device/source files of the
// same type collapse to a single entry backed by the largest (most complete) file.

import { findParser } from '../core/registry.js';
import { filesFromInput } from './loader.js';
import { renderChart, resizeChart } from './chart.js';
import { renderMap } from './map.js';
import { renderECG, resizeECG } from './ecg.js';
import { joinValues } from '../core/timejoin.js';
import { fitDataPointsParser } from '../parsers/fit-datapoints.js'; // registers
import { tcxParser } from '../parsers/tcx.js';                      // registers
import { ecgParser } from '../parsers/ecg.js';                      // registers

const el = (id) => document.getElementById(id);
const seriesCache = new Map();  // file name -> parsed Series
let metricEntries = [];         // one per metric type: { typeKey, label, best }
let actEntries = [];            // TCX activities
let ecgEntries = [];            // ECG readings
let currentTrack = null;
let currentReading = null;

// ---- folder load -------------------------------------------------------------
el('folder').addEventListener('change', async (e) => {
  const all = filesFromInput(e.target.files);

  // Collapse Fit "All Data" files to one entry per metric type (best = largest file).
  const byType = new Map();
  for (const f of all) {
    if (!/^(raw|derived)_com\.google\..+\.json$/i.test(f.name)) continue;
    const key = typeKeyOf(f.name);
    const cur = byType.get(key);
    if (!cur || f.size > cur.size) byType.set(key, f);
  }
  metricEntries = [...byType.entries()]
    .map(([typeKey, best]) => ({ typeKey, best, label: metricLabel(typeKey) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  actEntries = all
    .filter((f) => /\.tcx$/i.test(f.name))
    .map((f) => ({ ...f, ...fromActivityName(f.name) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  ecgEntries = all
    .filter((f) => ecgParser.match(f.name))
    .map((f) => ({ ...f, timeMs: +(f.name.match(/(\d+)\.csv$/) || [, 0])[1] }))
    .sort((a, b) => b.timeMs - a.timeMs);

  buildMetricList();
  buildActivityList();
  buildEcgList();

  // Default: show heart rate on the chart. Also parse speed quietly so the map can colour by it.
  const hr = metricEntries.find((m) => m.typeKey === 'heart_rate.bpm');
  const sp = metricEntries.find((m) => m.typeKey === 'speed');
  if (hr) { await ensureParsed(hr.best); const cb = el('cb_' + hr.typeKey); if (cb) cb.checked = true; }
  if (sp) await ensureParsed(sp.best);
  refreshColorByOptions();
  showView('chart');
  redrawChart();
});

// ---- sidebar: metrics --------------------------------------------------------
function buildMetricList() {
  const list = el('list');
  list.innerHTML = '';
  for (const m of metricEntries) {
    const row = document.createElement('label');
    row.className = 'row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'cb_' + m.typeKey;
    cb.addEventListener('change', async () => {
      showView('chart');
      if (cb.checked) { cb.disabled = true; await ensureParsed(m.best); cb.disabled = false; }
      refreshColorByOptions();
      redrawChart();
    });
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.label;
    row.append(cb, name);
    list.appendChild(row);
  }
}

// ---- sidebar: activities -----------------------------------------------------
function buildActivityList() {
  const box = el('activities');
  box.innerHTML = '';
  for (const f of actEntries) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<span>${f.date}</span><span class="sub">${f.sport} · ${f.dur}</span>`;
    row.addEventListener('click', () => { markSelected(box, row); openActivity(f); });
    box.appendChild(row);
  }
}

async function openActivity(f) {
  showView('map');
  setContext(`${f.date} · ${f.sport}`);
  setStatus('Loading activity …');
  await new Promise((r) => setTimeout(r));
  const text = await f.getText();
  const { track } = tcxParser.parseActivity(text, f.name);
  if (!track) {
    currentTrack = null;
    el('mapctl').classList.add('hidden');
    setStatus('This activity has no GPS data.');
    return;
  }
  currentTrack = track;
  el('mapctl').classList.remove('hidden');
  drawMap();
}

// ---- sidebar: ECG ------------------------------------------------------------
function buildEcgList() {
  const box = el('ecgreadings');
  box.innerHTML = '';
  for (const f of ecgEntries) {
    const row = document.createElement('div');
    row.className = 'item';
    const d = new Date(f.timeMs);
    const when = isNaN(d) ? f.name : d.toISOString().slice(0, 16).replace('T', ' ');
    row.innerHTML = `<span>${when}</span><span class="sub">ECG</span>`;
    row.addEventListener('click', () => { markSelected(box, row); openReading(f); });
    box.appendChild(row);
  }
}

async function openReading(f) {
  showView('ecg');
  setContext('ECG');
  setStatus('Loading ECG …');
  await new Promise((r) => setTimeout(r));
  const text = await f.getText();
  currentReading = ecgParser.parseReading(text, f.name);
  drawECG();
}

function drawECG() {
  if (!currentReading) return;
  renderECG(el('ecg'), currentReading);
  const r = currentReading;
  const when = new Date(r.timeMs);
  setContext(`ECG · ${isNaN(when) ? '' : when.toISOString().slice(0, 16).replace('T', ' ')}`);
  el('ecgmeta').classList.remove('hidden');
  el('ecgmeta').textContent =
    `${r.classification}${r.heartRate ? ' · ' + r.heartRate + ' bpm' : ''}` +
    `${r.device ? ' · ' + r.device : ''} · ${(r.samples.length / r.sampleRate).toFixed(0)}s @ ${r.sampleRate}Hz`;
  setStatus('scroll to zoom · drag to select · double-click to reset');
}

// ---- map colour-by -----------------------------------------------------------
function scalarSeries() {
  return metricEntries.map((m) => seriesCache.get(m.best.name)).filter(Boolean);
}

function refreshColorByOptions() {
  const sel = el('colorby');
  const prev = sel.value;
  sel.innerHTML = '';
  const seen = new Set();
  for (const s of scalarSeries()) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
el('colorby').addEventListener('change', drawMap);

function drawMap() {
  if (!currentTrack) return;
  const src = scalarSeries().find((s) => s.id === el('colorby').value) || scalarSeries()[0];
  let legend = 'no colour data';
  if (src) {
    const r = renderMap(el('map'), currentTrack, joinValues(currentTrack.t, src, 120));
    legend = r.colored ? `${src.label}: ${Math.round(r.min)}–${Math.round(r.max)} ${src.unit}` : `no ${src.label} near this activity`;
  } else {
    renderMap(el('map'), currentTrack, new Float64Array(currentTrack.t.length).fill(NaN));
  }
  el('legend').textContent = '· ' + legend;
  setStatus(`${currentTrack.lat.length} GPS points`);
}

// ---- parsing + chart ---------------------------------------------------------
async function ensureParsed(f) {
  if (seriesCache.has(f.name)) return seriesCache.get(f.name);
  setStatus('Loading …');
  await new Promise((r) => setTimeout(r));
  const out = findParser(f.name).parse(await f.getText(), f.name);
  seriesCache.set(f.name, out[0] || null);
  setStatus('');
  return seriesCache.get(f.name);
}

function redrawChart() {
  const chosen = metricEntries
    .filter((m) => { const cb = el('cb_' + m.typeKey); return cb && cb.checked; })
    .map((m) => seriesCache.get(m.best.name)).filter(Boolean);
  renderChart(el('chart'), chosen, buildMarkers(), openMarker);
  setContext(chosen.length ? chosen.map((s) => s.label).join('  +  ') : 'No metric selected');
  setStatus(chosen.length ? 'hover for values · click a top tick to open an activity/ECG · scroll to zoom' : 'Tick a metric on the left.');
}

// Event markers on the timeline (top ticks): activities and ECG readings, filterable.
function buildMarkers() {
  const out = [];
  if (el('showAct').checked)
    for (const f of actEntries) if (!Number.isNaN(f.tMs)) out.push({ t: f.tMs / 1000, kind: 'activity', ref: { kind: 'activity', f } });
  if (el('showEcg').checked)
    for (const f of ecgEntries) if (f.timeMs) out.push({ t: f.timeMs / 1000, kind: 'ecg', ref: { kind: 'ecg', f } });
  return out;
}
function openMarker(ref) {
  if (ref.kind === 'activity') openActivity(ref.f);
  else openReading(ref.f);
}
el('showAct').addEventListener('change', redrawChart);
el('showEcg').addEventListener('change', redrawChart);

// ---- view switching (follows selection; no tabs) -----------------------------
function showView(view) {
  el('chart').classList.toggle('hidden', view !== 'chart');
  el('map').classList.toggle('hidden', view !== 'map');
  el('ecg').classList.toggle('hidden', view !== 'ecg');
  el('chartctl').classList.toggle('hidden', view !== 'chart');
  el('mapctl').classList.toggle('hidden', view !== 'map' || !currentTrack);
  el('ecgmeta').classList.toggle('hidden', view !== 'ecg' || !currentReading);
  if (view === 'chart') resizeChart(el('chart'));
  if (view === 'map' && currentTrack) drawMap();
  if (view === 'ecg' && currentReading) { resizeECG(el('ecg')); drawECG(); }
}

// ---- helpers -----------------------------------------------------------------
const METRIC_LABELS = {
  'heart_rate.bpm': 'Heart rate', 'speed': 'Speed', 'step_count.delta': 'Steps',
  'step_count.cumulative': 'Steps (cumulative)', 'step_count.cadence': 'Step cadence',
  'distance.delta': 'Distance', 'calories.expended': 'Calories', 'calories.bmr': 'Calories (BMR)',
  'active_minutes': 'Active minutes', 'heart_minutes': 'Heart points', 'weight': 'Weight', 'height': 'Height',
  'respiratory_rate': 'Respiratory rate', 'nutrition': 'Nutrition', 'hydration': 'Hydration',
  'activity.segment': 'Activity segments', 'activity.samples': 'Activity samples',
  'location.sample': 'Location samples', 'sleep.segment': 'Sleep', 'body.temperature': 'Body temperature',
  'oxygen_saturation': 'Oxygen saturation', 'sensor.events': 'Sensor events',
  'internal.goal': 'Goals', 'internal.paced_walking_attr': 'Paced walking',
  'internal.sleep_attributes': 'Sleep attributes', 'internal.sleep_schedule': 'Sleep schedule',
};
function metricLabel(key) {
  return METRIC_LABELS[key] || key.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// A data type contains underscores (e.g. step_count.cumulative) and so does the source that
// follows it, so the type/source boundary can't be found by splitting on "_". Match the known
// data-type prefixes instead; unknown types fall back to their first token.
const KNOWN_TYPES = [
  'heart_rate.bpm', 'step_count.delta', 'step_count.cumulative', 'step_count.cadence',
  'distance.delta', 'speed', 'calories.expended', 'calories.bmr', 'activity.segment', 'activity.samples',
  'active_minutes', 'heart_minutes', 'weight', 'height', 'respiratory_rate', 'nutrition', 'hydration',
  'location.sample', 'sleep.segment', 'body.temperature', 'oxygen_saturation', 'blood_pressure',
  'internal.goal', 'internal.paced_walking_attr', 'internal.sleep_attributes', 'internal.sleep_schedule',
  'sensor.events',
];
function typeKeyOf(name) {
  const after = name.replace(/^(raw|derived)_com\.google\./i, '');
  for (const t of KNOWN_TYPES) {
    if (after.startsWith(t + '_') || after === t + '.json') return t;
  }
  const m = after.match(/^([a-z]+(?:_[a-z]+)*)/); // fallback: first token
  return m ? m[1] : name;
}

function fromActivityName(name) {
  const date = (name.match(/^(\d{4}-\d{2}-\d{2})/) || [, '?'])[1];
  const sport = (name.match(/_([A-Za-z]+)\.tcx$/) || [, 'Activity'])[1];
  const iso = (name.match(/_PT([0-9HMS.]+)_/) || [, ''])[1];
  return { date, sport, dur: prettyDuration(iso), tMs: activityTimeMs(name) };
}
// Full start time from the filename (underscores in the time/tz are ":"), for timeline markers.
function activityTimeMs(name) {
  const pre = name.split('_PT')[0];
  const ms = Date.parse(pre.replace(/_/g, ':'));
  if (!Number.isNaN(ms)) return ms;
  const d = name.match(/^(\d{4}-\d{2}-\d{2})/);
  return d ? Date.parse(d[1]) : NaN;
}
function prettyDuration(iso) {
  if (!iso) return '';
  const h = (iso.match(/(\d+)H/) || [, 0])[1];
  const m = (iso.match(/(\d+)M/) || [, 0])[1];
  return (h > 0 ? h + 'h' : '') + (m > 0 || h > 0 ? m + 'm' : Math.round(parseFloat(iso)) + 's');
}

function markSelected(box, row) {
  box.querySelectorAll('.item.on').forEach((r) => r.classList.remove('on'));
  row.classList.add('on');
}
function setContext(msg) { el('context').textContent = msg; }
function setStatus(msg) { el('status').textContent = msg; }

window.addEventListener('resize', () => resizeChart(el('chart')));
