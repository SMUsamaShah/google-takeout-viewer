// Orchestration: pick folder -> list parseable files -> parse selected ones lazily ->
// chart them. Heart rate + speed are auto-selected on load (largest file per type,
// which is the merged, most-complete series) so there's an immediate result.

import { findParser } from '../core/registry.js';
import { filesFromInput } from './loader.js';
import { renderChart, resizeChart } from './chart.js';
import '../parsers/fit-datapoints.js'; // registers the Fit parser

const el = (id) => document.getElementById(id);
const seriesCache = new Map(); // entry.name -> Series
let entries = [];              // parseable file entries, with a `typeKey`

function typeKeyOf(name) {
  const m = name.match(/com\.google\.([a-z_.]+?)_com/i);
  return m ? m[1] : name;
}

function prettyType(key) {
  return key.replace(/\./g, ' ').replace(/_/g, ' ');
}

el('folder').addEventListener('change', (e) => {
  const all = filesFromInput(e.target.files);
  entries = all
    .filter((f) => findParser(f.name))
    .map((f) => ({ ...f, typeKey: typeKeyOf(f.name), kind: f.name.startsWith('raw') ? 'raw' : 'derived' }))
    .sort((a, b) => a.typeKey.localeCompare(b.typeKey) || b.size - a.size);

  buildList();

  // Auto-select the largest heart-rate and speed file (the merged superset).
  const defaults = [];
  for (const key of ['heart_rate.bpm', 'speed']) {
    const best = entries.filter((x) => x.typeKey === key).sort((a, b) => b.size - a.size)[0];
    if (best) defaults.push(best);
  }
  Promise.all(defaults.map(ensureParsed)).then(() => {
    defaults.forEach((d) => { const cb = el('cb_' + d.name); if (cb) cb.checked = true; });
    redraw();
  });
});

function buildList() {
  const list = el('list');
  list.innerHTML = '';
  let lastType = null;
  for (const f of entries) {
    if (f.typeKey !== lastType) {
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = prettyType(f.typeKey);
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
      redraw();
    });
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${f.kind} · ${(f.size / 1e6).toFixed(1)} MB`;
    row.append(cb, meta);
    list.appendChild(row);
  }
}

async function ensureParsed(f) {
  if (seriesCache.has(f.name)) return seriesCache.get(f.name);
  setStatus(`Parsing ${f.name} …`);
  await new Promise((r) => setTimeout(r)); // let status paint before blocking parse
  const text = await f.getText();
  const parser = findParser(f.name);
  const out = parser.parse(text, f.name);
  const s = out[0] || null;
  seriesCache.set(f.name, s);
  setStatus('');
  return s;
}

function redraw() {
  const chosen = entries
    .filter((f) => { const cb = el('cb_' + f.name); return cb && cb.checked; })
    .map((f) => seriesCache.get(f.name))
    .filter(Boolean);
  renderChart(el('chart'), chosen);
  setStatus(chosen.length ? `${chosen.length} series · scroll to zoom, drag to select, double-click to reset` : 'No series selected');
}

function setStatus(msg) { el('status').textContent = msg; }

window.addEventListener('resize', () => resizeChart(el('chart')));
