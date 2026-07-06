// Orchestration. Two views share one folder load:
//  - Data (chart): Fit "All Data" JSON series (heart rate, speed, ...), overlaid on time.
//  - Activities (map): TCX GPS tracks, drawn on OpenStreetMap and coloured by a chosen series.
// Heart rate + speed auto-load so both the default chart and map colouring work immediately.

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
const seriesCache = new Map(); // data-file name -> Series
let dataEntries = [];          // parseable Fit "All Data" files
let actEntries = [];           // TCX activity files
let ecgEntries = [];           // ECG reading files
let currentTrack = null;       // parsed track shown on the map
let currentReading = null;     // parsed ECG reading shown on the ECG view

// ---- folder load -------------------------------------------------------------
el('folder').addEventListener('change', async (e) => {
  const all = filesFromInput(e.target.files);

  dataEntries = all
    .filter((f) => /^(raw|derived)_com\.google\..+\.json$/i.test(f.name))
    .map((f) => ({ ...f, typeKey: typeKeyOf(f.name), kind: f.name.startsWith('raw') ? 'raw' : 'derived' }))
    .sort((a, b) => a.typeKey.localeCompare(b.typeKey) || b.size - a.size);

  actEntries = all
    .filter((f) => /\.tcx$/i.test(f.name))
    .map((f) => ({ ...f, ...fromActivityName(f.name) }))
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first

  ecgEntries = all
    .filter((f) => ecgParser.match(f.name))
    .map((f) => ({ ...f, timeMs: +(f.name.match(/(\d+)\.csv$/) || [, 0])[1] }))
    .sort((a, b) => b.timeMs - a.timeMs);

  buildDataList();
  buildActivityList();
  buildEcgList();

  // Parse heart rate + speed so both are ready (speed is a map colour source), but only
  // auto-show heart rate on the chart: overlaying two different-unit metrics across ~11 years
  // is an unreadable default. Speed is one tick away in the list.
  const defaults = [];
  for (const key of ['heart_rate.bpm', 'speed']) {
    const best = dataEntries.filter((x) => x.typeKey === key).sort((a, b) => b.size - a.size)[0];
    if (best) defaults.push(best);
  }
  await Promise.all(defaults.map(ensureParsed));
  const hr = defaults.find((d) => d.typeKey === 'heart_rate.bpm');
  if (hr) { const cb = el('cb_' + hr.name); if (cb) cb.checked = true; }
  refreshColorByOptions();
  redrawChart();
});

// ---- data (chart) list -------------------------------------------------------
function buildDataList() {
  const list = el('list');
  list.innerHTML = '';
  let lastType = null;
  for (const f of dataEntries) {
    if (f.typeKey !== lastType) {
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = f.typeKey.replace(/[._]/g, ' ');
      list.appendChild(h);
      lastType = f.typeKey;
    }
    const row = document.createElement('label');
    row.className = 'row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'cb_' + f.name;
    cb.addEventListener('change', async () => {
      if (cb.checked) { cb.disabled = true; await ensureParsed(f); cb.disabled = false; }
      refreshColorByOptions();
      redrawChart();
    });
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${f.kind} · ${(f.size / 1e6).toFixed(1)} MB`;
    row.append(cb, meta);
    list.appendChild(row);
  }
}

// ---- activities (map) list ---------------------------------------------------
function buildActivityList() {
  const box = el('activities');
  box.innerHTML = '';
  for (const f of actEntries) {
    const row = document.createElement('div');
    row.className = 'act';
    row.innerHTML = `<span>${f.date}</span><span class="sport">${f.sport} · ${f.dur}</span>`;
    row.addEventListener('click', () => openActivity(f));
    box.appendChild(row);
  }
}

async function openActivity(f) {
  showView('map');
  setStatus(`Loading ${f.date} ${f.sport} …`);
  await new Promise((r) => setTimeout(r));
  const text = await f.getText();
  const { track } = tcxParser.parseActivity(text, f.name);
  if (!track) { currentTrack = null; setStatus(`${f.date} ${f.sport}: no GPS data in this activity`); el('mapctl').classList.add('hidden'); return; }
  currentTrack = track;
  el('mapctl').classList.remove('hidden');
  drawMap();
}

// ---- ECG list ----------------------------------------------------------------
function buildEcgList() {
  const box = el('ecgreadings');
  box.innerHTML = '';
  for (const f of ecgEntries) {
    const row = document.createElement('div');
    row.className = 'act';
    const d = new Date(f.timeMs);
    const when = isNaN(d) ? f.name : d.toISOString().slice(0, 16).replace('T', ' ');
    row.innerHTML = `<span>${when}</span><span class="sport">ECG</span>`;
    row.addEventListener('click', () => openReading(f));
    box.appendChild(row);
  }
}

async function openReading(f) {
  showView('ecg');
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
  el('ecgmeta').classList.remove('hidden');
  el('ecgmeta').textContent =
    `${isNaN(when) ? '' : when.toISOString().slice(0, 16).replace('T', ' ')} · ${r.classification}` +
    `${r.heartRate ? ' · ' + r.heartRate + ' bpm' : ''}${r.device ? ' · ' + r.device : ''} · ` +
    `${(r.samples.length / r.sampleRate).toFixed(0)}s @ ${r.sampleRate}Hz`;
  setStatus('scroll to zoom, drag to select, double-click to reset');
}

// ---- colour-by control -------------------------------------------------------
function scalarSeries() {
  // parsed data-file series usable as a colour source
  return dataEntries.filter((f) => seriesCache.get(f.name)).map((f) => seriesCache.get(f.name));
}

function refreshColorByOptions() {
  const sel = el('colorby');
  const prev = sel.value;
  sel.innerHTML = '';
  const seen = new Set();
  for (const s of scalarSeries()) {
    if (seen.has(s.label)) continue; seen.add(s.label);
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
    const values = joinValues(currentTrack.t, src, 120);
    const r = renderMap(el('map'), currentTrack, values);
    legend = r.colored ? `${src.label}: ${Math.round(r.min)}–${Math.round(r.max)} ${src.unit}` : `no ${src.label} near this activity`;
  } else {
    renderMap(el('map'), currentTrack, new Float64Array(currentTrack.t.length).fill(NaN));
  }
  el('legend').textContent = '· ' + legend;
  setStatus(`${currentTrack.sport} · ${currentTrack.lat.length} GPS points`);
}

// ---- parsing -----------------------------------------------------------------
async function ensureParsed(f) {
  if (seriesCache.has(f.name)) return seriesCache.get(f.name);
  setStatus(`Parsing ${f.name} …`);
  await new Promise((r) => setTimeout(r));
  const text = await f.getText();
  const out = findParser(f.name).parse(text, f.name);
  const s = out[0] || null;
  seriesCache.set(f.name, s);
  setStatus('');
  return s;
}

function redrawChart() {
  const chosen = dataEntries
    .filter((f) => { const cb = el('cb_' + f.name); return cb && cb.checked; })
    .map((f) => seriesCache.get(f.name)).filter(Boolean);
  renderChart(el('chart'), chosen);
  setStatus(chosen.length ? `${chosen.length} series · scroll to zoom, drag to select, double-click to reset` : 'No series selected');
}

// ---- view switching ----------------------------------------------------------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
function showView(view) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  el('chart').classList.toggle('hidden', view !== 'chart');
  el('map').classList.toggle('hidden', view !== 'map');
  el('ecg').classList.toggle('hidden', view !== 'ecg');
  el('mapctl').classList.toggle('hidden', view !== 'map' || !currentTrack);
  el('ecgmeta').classList.toggle('hidden', view !== 'ecg' || !currentReading);
  if (view === 'chart') resizeChart(el('chart'));
  if (view === 'map' && currentTrack) drawMap();
  if (view === 'ecg' && currentReading) { resizeECG(el('ecg')); drawECG(); }
}

// ---- helpers -----------------------------------------------------------------
function typeKeyOf(name) { const m = name.match(/com\.google\.([a-z_.]+?)_com/i); return m ? m[1] : name; }

function fromActivityName(name) {
  // e.g. 2022-07-02T10_58_00+01_00_PT6M_Walking.tcx
  const date = (name.match(/^(\d{4}-\d{2}-\d{2})/) || [,'?'])[1];
  const sport = (name.match(/_([A-Za-z]+)\.tcx$/) || [,'Activity'])[1];
  const iso = (name.match(/_PT([0-9HMS.]+)_/) || [,''])[1];
  return { date, sport, dur: prettyDuration(iso) };
}
function prettyDuration(iso) {
  if (!iso) return '';
  const h = (iso.match(/(\d+)H/) || [,0])[1];
  const m = (iso.match(/(\d+)M/) || [,0])[1];
  return (h > 0 ? h + 'h' : '') + (m > 0 || h > 0 ? m + 'm' : Math.round(parseFloat(iso)) + 's');
}

function setStatus(msg) { el('status').textContent = msg; }
window.addEventListener('resize', () => resizeChart(el('chart')));
