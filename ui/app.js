// Orchestration for the health timeline.
//
// The shape of the app follows the question it exists to answer: "how is my heart doing —
// right now, through the day, and against six months ago?" So heart rate is the hero lane,
// every other metric is a lane stacked under it on the same time axis, and a moment in time
// is a vertical slice you can read straight down (the inspector) rather than a mode you
// switch into. Activities and ECG readings ride the same axis as a ribbon; opening one is a
// detail sheet over the timeline, not a separate view that loses your place.

import { findParser } from '../core/registry.js';
import { filesFromInput } from './loader.js';
import { renderTimeline, destroyTimeline, timeline, sampleAt, fmtVal } from './timeline.js';
import { renderStats, renderTable } from './stats.js';
import { renderMap } from './map.js';
import { renderECG, resizeECG } from './ecg.js';
import { joinValues } from '../core/timejoin.js';
import { fitDataPointsParser } from '../parsers/fit-datapoints.js'; // registers
import { fitDailyParser } from '../parsers/fit-daily.js';           // registers
import { tcxParser } from '../parsers/tcx.js';                      // registers
import { ecgParser } from '../parsers/ecg.js';                      // registers

const el = (id) => document.getElementById(id);
const DAY = 86400;

// Colour follows the entity, never its position in the list: a metric keeps its hue when
// others are filtered out. Slots are the validated categorical order (see index.html).
const METRIC_SLOT = {
  'heart_rate.bpm': 1, 'step_count.delta': 2, 'speed': 3, 'distance.delta': 4,
  'calories.expended': 5, 'active_minutes': 6, 'weight': 7, 'respiratory_rate': 8,
};
// Heart rate deliberately takes slot 1 (blue), not the red you might expect: red is a
// reserved status colour here (ECG / flagged events), and painting a heart-condition
// user's own pulse in alarm-red all day is both wrong by the palette rules and unkind.

const seriesCache = new Map();
let metricEntries = [], actEntries = [], ecgEntries = [];
let dailyHR = null, hrSeries = null;
let selected = new Set();
let pinnedT = null;
let currentTrack = null, currentReading = null;

// ---- folder load ----------------------------------------------------------------
el('folder').addEventListener('change', async (e) => {
  const all = filesFromInput(e.target.files);
  setStatus('Reading folder …');

  const byType = new Map();
  for (const f of all) {
    if (!/^(raw|derived)_com\.google\..+\.json$/i.test(f.name)) continue;
    const key = typeKeyOf(f.name);
    const cur = byType.get(key);
    if (!cur || f.size > cur.size) byType.set(key, f);
  }
  // Hide streams with nothing chartable (bookkeeping, sensor dumps, segment rows) — they
  // only ever produced empty boxes.
  const HIDE = /^(internal|sensor|location|activity|nutrition|hydration)\b/;
  metricEntries = [...byType.entries()]
    .filter(([k]) => !HIDE.test(k))
    .map(([typeKey, best]) => ({ typeKey, best, label: metricLabel(typeKey) }))
    .sort((a, b) => (a.typeKey === 'heart_rate.bpm' ? -1 : b.typeKey === 'heart_rate.bpm' ? 1 : a.label.localeCompare(b.label)));

  actEntries = all.filter((f) => /\.tcx$/i.test(f.name)).map((f) => {
    const d = fromActivityName(f.name);
    return { ...f, ...d, t: d.tMs / 1000, dur: d.durSec, ref: f };
  }).filter((a) => Number.isFinite(a.t)).sort((a, b) => a.t - b.t);

  ecgEntries = all.filter((f) => ecgParser.match(f.name)).map((f) => {
    const ms = +(f.name.match(/(\d+)\.csv$/) || [, 0])[1];
    return { ...f, t: ms / 1000, ref: f };
  }).filter((x) => x.t > 0).sort((a, b) => a.t - b.t);

  setStatus('Parsing heart rate …');
  await tick();

  const hr = metricEntries.find((m) => m.typeKey === 'heart_rate.bpm');
  if (hr) { hrSeries = await ensureParsed(hr.best); selected.add(hr.typeKey); }

  const dailyFile = all.find((f) => fitDailyParser.match(f.name));
  dailyHR = dailyFile ? await ensureParsed(dailyFile) : null;

  const sp = metricEntries.find((m) => m.typeKey === 'speed');
  if (sp) await ensureParsed(sp.best); // map colour source

  buildChips();
  setStatus('');
  render();

  // Open on the most recent continuous stretch of heart rate: bursty data means a fixed
  // window often lands on emptiness, so walk back from the last sample to the last big gap.
  if (hrSeries?.xs?.length > 1) {
    const xs = hrSeries.xs, n = xs.length;
    let start = 0;
    for (let i = n - 1; i > 0; i--) if (xs[i] - xs[i - 1] > 2 * DAY) { start = i; break; }
    timeline()?.setWindow(xs[start], xs[n - 1]);
  }
  syncAfterWindow();
});

// ---- metric chips ---------------------------------------------------------------
function buildChips() {
  const box = el('chips');
  box.innerHTML = '';
  for (const m of metricEntries) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('aria-pressed', selected.has(m.typeKey) ? 'true' : 'false');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorFor(m.typeKey);
    const name = document.createElement('span');
    name.textContent = m.label;
    b.append(dot, name);
    b.addEventListener('click', async () => {
      if (selected.has(m.typeKey)) selected.delete(m.typeKey);
      else {
        b.disabled = true; setStatus(`Loading ${m.label} …`); await tick();
        const s = await ensureParsed(m.best);
        b.disabled = false; setStatus('');
        if (!s?.xs?.length) { b.disabled = true; b.title = 'No chartable data in this file'; return; }
        selected.add(m.typeKey);
      }
      b.setAttribute('aria-pressed', selected.has(m.typeKey) ? 'true' : 'false');
      const keep = timeline()?.getWindow();
      render();
      if (keep) timeline()?.setWindow(keep.min, keep.max);
      syncAfterWindow();
    });
    box.appendChild(b);
  }
}

function colorFor(typeKey) {
  const slot = METRIC_SLOT[typeKey];
  if (slot) return `var(--s${slot})`;
  // Unknown metrics get neutral ink rather than a generated 9th hue.
  return 'var(--muted)';
}

// ---- render ---------------------------------------------------------------------
function render() {
  const lanes = [];
  for (const m of metricEntries) {
    if (!selected.has(m.typeKey)) continue;
    const s = seriesCache.get(m.best.name);
    if (!s?.xs?.length) continue;
    const hero = m.typeKey === 'heart_rate.bpm';
    lanes.push({
      key: m.typeKey, label: m.label, unit: s.unit || '', color: colorFor(m.typeKey),
      series: s, band: hero ? dailyHR : null, hero,
    });
  }
  // Heart rate takes whatever vertical room the other lanes don't need, so the hero lane
  // fills the window instead of leaving dead space under a fixed-height stack.
  const HEAD = 34, RIBBON = 54, SECONDARY = 108;
  const content = document.querySelector('.content');
  const avail = (content?.clientHeight || 620)
    - (el('kpis').offsetHeight || 0) - 16
    - (hrSeries ? (el('coverage').offsetHeight || 96) + 14 : 0)
    - (el('tablewrap').classList.contains('hidden') ? 0 : (el('tablewrap').offsetHeight || 0) + 14)
    - 24;
  const others = lanes.filter((l) => !l.hero).length;
  const ribbon = (actEntries.length || ecgEntries.length) ? RIBBON + HEAD : 0;
  const heroH = avail - lanes.length * HEAD - others * SECONDARY - ribbon;
  for (const l of lanes) l.height = l.hero ? clamp(heroH, 190, 560) : SECONDARY;
  if (!lanes.some((l) => l.hero) && lanes.length) {
    const each = clamp((avail - lanes.length * HEAD - ribbon) / lanes.length, 110, 300);
    for (const l of lanes) l.height = each;
  }

  renderTimeline(el('lanes'), {
    lanes,
    activities: actEntries,
    ecgs: ecgEntries,
    onHover: (t) => { if (pinnedT == null) updateInspector(t, false); },
    onPick: ({ t, event }) => {
      if (event) return openEvent(event);
      pinnedT = t;
      updateInspector(t, true);
    },
    onRange: () => scheduleWindowSync(),
  });

  el('coverage').classList.toggle('hidden', !hrSeries);
  drawCoverage();
  syncAfterWindow();
}

let syncTimer = null;
function scheduleWindowSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAfterWindow, 90); // debounce during pan/zoom
}

// Everything scoped to the window re-computes together, so the numbers always agree.
function syncAfterWindow() {
  const t = timeline();
  if (!t) return;
  const win = t.getWindow();
  renderStats(el('kpis'), { daily: dailyHR, hr: hrSeries, win });
  if (!el('tablewrap').classList.contains('hidden')) renderTable(el('dtable'), dailyHR, win);
  drawCoverage();
  markActiveRange(win);
  if (pinnedT != null) updateInspector(pinnedT, true);
}

// ---- inspector ------------------------------------------------------------------
function updateInspector(t, pinned) {
  if (!Number.isFinite(t)) return;
  el('inspWhen').textContent = new Date(t * 1000).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  el('inspSub').textContent = pinned ? 'Pinned — click the timeline again to move it' : 'Hovering';

  const body = el('inspBody');
  body.innerHTML = '';

  const readout = document.createElement('div');
  readout.className = 'readout';
  let any = false;
  for (const m of metricEntries) {
    if (!selected.has(m.typeKey)) continue;
    const s = seriesCache.get(m.best.name);
    if (!s?.xs?.length) continue;
    const v = sampleAt(s, t);
    if (v != null) any = true;
    readout.appendChild(readRow(m.label, colorFor(m.typeKey), v, s.unit));
  }
  // The daily band's own numbers for that day — the context the raw sample sits in.
  if (dailyHR) {
    const i = nearestIdx(dailyHR.xs, t);
    if (i >= 0 && Math.abs(dailyHR.xs[i] - t) < DAY) {
      readout.appendChild(readRow('That day — resting', 'var(--band)', dailyHR.lo?.[i], 'bpm'));
      readout.appendChild(readRow('That day — peak', 'var(--band)', dailyHR.hi?.[i], 'bpm'));
    }
  }
  body.appendChild(readout);

  if (!any) {
    const p = document.createElement('p');
    p.className = 'insp-hint';
    p.style.marginTop = '12px';
    p.textContent = 'No samples recorded at this moment — the watch was not logging here.';
    body.appendChild(p);
  }

  // What was happening then: activities overlapping, ECGs nearby.
  const near = [];
  for (const a of actEntries) {
    if (t >= a.t - 60 && t <= a.t + (a.dur || 0) + 60) near.push({ kind: 'activity', label: a.sport, t: a.t, dur: a.dur, ref: a.ref });
  }
  for (const e of ecgEntries) if (Math.abs(e.t - t) < 3 * 3600) near.push({ kind: 'ecg', label: 'ECG reading', t: e.t, ref: e.ref });
  near.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));

  if (near.length) {
    const sec = document.createElement('div');
    sec.className = 'insp-sec';
    const h = document.createElement('h4'); h.textContent = 'Around this time';
    sec.appendChild(h);
    for (const n of near.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'ev';
      const i = document.createElement('span');
      i.className = 'i';
      i.style.background = n.kind === 'ecg' ? 'var(--critical)' : 'var(--s3)';
      const nm = document.createElement('span');
      nm.textContent = n.kind === 'ecg' ? 'ECG reading' : `${n.label}${n.dur ? ` · ${fmtDur(n.dur)}` : ''}`;
      const tm = document.createElement('span');
      tm.className = 't';
      tm.textContent = new Date(n.t * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      row.append(i, nm, tm);
      row.addEventListener('click', () => openEvent({ kind: n.kind, ref: n.ref, label: n.label }));
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
}

function readRow(name, color, v, unit) {
  const r = document.createElement('div');
  r.className = 'r';
  const k = document.createElement('i'); k.className = 'key'; k.style.background = color;
  const n = document.createElement('span'); n.className = 'n'; n.textContent = name;
  const val = document.createElement('span'); val.className = 'val';
  if (v == null || !Number.isFinite(v)) { val.classList.add('none'); val.textContent = 'no data'; }
  else {
    val.append(document.createTextNode(fmtVal(v)));
    if (unit) { const s = document.createElement('small'); s.textContent = unit; val.appendChild(s); }
  }
  r.append(k, n, val);
  return r;
}

// ---- coverage navigator ----------------------------------------------------------
function drawCoverage() {
  const cv = el('covcanvas');
  if (!cv || !hrSeries) return;
  const t = timeline();
  const ext = t ? t.extent : null;
  if (!ext) return;
  const win = t.getWindow();
  const r = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 34;
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  const ctx = cv.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const span = ext.max - ext.min;
  const bins = Math.max(40, Math.floor(w));
  const counts = new Float64Array(bins);
  const xs = hrSeries.xs;
  const stride = Math.max(1, Math.floor(xs.length / 40000)); // sampled: this is a density sketch
  for (let i = 0; i < xs.length; i += stride) {
    const b = Math.floor(((xs[i] - ext.min) / span) * bins);
    if (b >= 0 && b < bins) counts[b]++;
  }
  let mx = 0; for (const c of counts) if (c > mx) mx = c;

  // Density is sqrt-scaled: a single dense burst would otherwise flatten every other period
  // to an invisible sliver, hiding years that genuinely have data.
  ctx.fillStyle = css.getPropertyValue('--s1').trim() || '#2a78d6';
  for (let b = 0; b < bins; b++) {
    if (!counts[b]) continue;
    const f = Math.sqrt(counts[b] / mx);
    const hh = Math.max(4, f * 20);
    ctx.globalAlpha = 0.5 + 0.5 * f;
    ctx.fillRect((b / bins) * w, 21 - hh, Math.max(1.5, w / bins), hh);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = css.getPropertyValue('--s3').trim() || '#1baf7a';
  for (const a of actEntries) {
    const x = ((a.t - ext.min) / span) * w;
    ctx.fillRect(x, 24, 1.5, 4);
  }
  ctx.fillStyle = css.getPropertyValue('--critical').trim() || '#d03b3b';
  for (const e of ecgEntries) {
    const x = ((e.t - ext.min) / span) * w;
    ctx.fillRect(x, 29, 1.5, 5);
  }

  // Current window — dim everything outside it rather than tinting inside it, so the viewport
  // stays legible even when it is only a few pixels wide (a day inside five years).
  const x0 = ((win.min - ext.min) / span) * w, x1 = ((win.max - ext.min) / span) * w;
  const vw = Math.max(3, x1 - x0);
  ctx.fillStyle = css.getPropertyValue('--surface').trim() || '#fff';
  ctx.globalAlpha = 0.62;
  ctx.fillRect(0, 0, Math.max(0, x0), h);
  ctx.fillRect(x0 + vw, 0, Math.max(0, w - x0 - vw), h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = css.getPropertyValue('--ink').trim() || '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.round(x0) + .75, .75, vw, h - 1.5);

  el('covrange').textContent = `${dateStr(ext.min)} – ${dateStr(ext.max)}`;
}

(function wireCoverage() {
  const cv = el('covcanvas');
  let dragging = false;
  const jump = (clientX) => {
    const t = timeline(); if (!t) return;
    const ext = t.extent, win = t.getWindow();
    const rect = cv.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const center = ext.min + f * (ext.max - ext.min);
    const half = (win.max - win.min) / 2;
    t.setWindow(center - half, center + half);
    scheduleWindowSync();
  };
  cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture(e.pointerId); jump(e.clientX); });
  cv.addEventListener('pointermove', (e) => { if (dragging) jump(e.clientX); });
  cv.addEventListener('pointerup', (e) => { dragging = false; cv.releasePointerCapture?.(e.pointerId); });
  window.addEventListener('resize', () => { drawCoverage(); });
})();

// ---- range presets ---------------------------------------------------------------
el('ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const t = timeline(); if (!t) return;
  const days = +b.dataset.days;
  const ext = t.extent;
  // Anchor to the end of the data, not "now" — an export is historical by nature.
  const end = ext.max;
  t.setWindow(days === 0 ? ext.min : end - days * DAY, end);
  syncAfterWindow();
});

function markActiveRange(win) {
  const span = (win.max - win.min) / DAY;
  const t = timeline();
  const full = t ? (t.extent.max - t.extent.min) / DAY : 0;
  let best = null;
  for (const b of el('ranges').querySelectorAll('button')) {
    const d = +b.dataset.days;
    const target = d === 0 ? full : d;
    const err = Math.abs(Math.log((span || 1) / (target || 1)));
    if (err < 0.08 && (best === null || err < best.err)) best = { b, err };
    b.setAttribute('aria-pressed', 'false');
  }
  if (best) best.b.setAttribute('aria-pressed', 'true');
}

// ---- table toggle ----------------------------------------------------------------
el('tableBtn').addEventListener('click', () => {
  const wrap = el('tablewrap');
  const show = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !show);
  el('tableBtn').setAttribute('aria-pressed', show ? 'true' : 'false');
  if (show) renderTable(el('dtable'), dailyHR, timeline()?.getWindow() || { min: -Infinity, max: Infinity });
});

// ---- theme -----------------------------------------------------------------------
el('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', next);
  const keep = timeline()?.getWindow();
  render();                                  // re-read CSS custom properties for the new theme
  if (keep) timeline()?.setWindow(keep.min, keep.max);
  syncAfterWindow();
});

// ---- detail sheet (map / ECG) ------------------------------------------------------
function openSheet(title) {
  el('sheetTitle').textContent = title;
  el('overlay').classList.remove('hidden');
}
function closeSheet() {
  el('overlay').classList.add('hidden');
  el('map').classList.add('hidden');
  el('ecg').classList.add('hidden');
  el('sheetCtl').classList.add('hidden');
}
el('sheetClose').addEventListener('click', closeSheet);
el('overlay').addEventListener('click', (e) => { if (e.target === el('overlay')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

async function openEvent(ev) {
  if (ev.kind === 'activity') return openActivity(ev.ref);
  if (ev.kind === 'ecg') return openReading(ev.ref);
}

async function openActivity(f) {
  openSheet('Activity');
  el('map').classList.remove('hidden');
  el('sheetMeta').textContent = 'Loading activity …';
  await tick();
  const text = await f.getText();
  const { track } = tcxParser.parseActivity(text, f.name);
  if (!track) { currentTrack = null; el('sheetMeta').textContent = 'This activity has no GPS data.'; return; }
  currentTrack = track;
  el('sheetCtl').classList.remove('hidden');
  refreshColorByOptions();
  drawMap();
}

function drawMap() {
  if (!currentTrack) return;
  const opts = scalarSeries();
  const src = opts.find((s) => s.id === el('colorby').value) || opts[0];
  if (src) {
    const r = renderMap(el('map'), currentTrack, joinValues(currentTrack.t, src, 120));
    el('legend').textContent = r.colored ? `${src.label}: ${Math.round(r.min)}–${Math.round(r.max)} ${src.unit}` : `no ${src.label} near this activity`;
  } else {
    renderMap(el('map'), currentTrack, new Float64Array(currentTrack.t.length).fill(NaN));
    el('legend').textContent = 'no colour data';
  }
  el('sheetMeta').textContent = `${currentTrack.lat.length} GPS points`;
}
el('colorby').addEventListener('change', drawMap);

function scalarSeries() {
  return metricEntries.map((m) => seriesCache.get(m.best.name)).filter((s) => s?.xs?.length);
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

async function openReading(f) {
  openSheet('ECG');
  el('ecg').classList.remove('hidden');
  el('sheetMeta').textContent = 'Loading ECG …';
  await tick();
  const text = await f.getText();
  currentReading = ecgParser.parseReading(text, f.name);
  renderECG(el('ecg'), currentReading);
  resizeECG(el('ecg'));
  const r = currentReading;
  el('sheetMeta').textContent =
    `${r.classification}${r.heartRate ? ' · ' + r.heartRate + ' bpm' : ''}` +
    `${r.device ? ' · ' + r.device : ''} · ${(r.samples.length / r.sampleRate).toFixed(0)}s @ ${r.sampleRate}Hz`;
}

// ---- parsing ----------------------------------------------------------------------
async function ensureParsed(f) {
  if (seriesCache.has(f.name)) return seriesCache.get(f.name);
  const p = findParser(f.name);
  if (!p) { seriesCache.set(f.name, null); return null; }
  const out = p.parse(await f.getText(), f.name);
  seriesCache.set(f.name, out[0] || null);
  return seriesCache.get(f.name);
}

// ---- helpers -----------------------------------------------------------------------
const METRIC_LABELS = {
  'heart_rate.bpm': 'Heart rate', 'speed': 'Speed', 'step_count.delta': 'Steps',
  'step_count.cumulative': 'Steps (cumulative)', 'step_count.cadence': 'Step cadence',
  'distance.delta': 'Distance', 'calories.expended': 'Calories', 'calories.bmr': 'Calories (BMR)',
  'active_minutes': 'Active minutes', 'heart_minutes': 'Heart points', 'weight': 'Weight', 'height': 'Height',
  'respiratory_rate': 'Breathing rate', 'sleep.segment': 'Sleep', 'body.temperature': 'Body temperature',
  'oxygen_saturation': 'Oxygen saturation',
};
function metricLabel(key) {
  return METRIC_LABELS[key] || key.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

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
  for (const t of KNOWN_TYPES) if (after.startsWith(t + '_') || after === t + '.json') return t;
  const m = after.match(/^([a-z]+(?:_[a-z]+)*)/);
  return m ? m[1] : name;
}

function fromActivityName(name) {
  const date = (name.match(/^(\d{4}-\d{2}-\d{2})/) || [, '?'])[1];
  const sport = ((name.match(/_([A-Za-z_]+)\.tcx$/) || [, 'Activity'])[1] || 'Activity').replace(/_/g, ' ');
  const iso = (name.match(/_PT([0-9HMS.]+)_/) || [, ''])[1];
  return { date, sport, durSec: isoSeconds(iso), tMs: activityTimeMs(name) };
}
function isoSeconds(iso) {
  if (!iso) return 0;
  const h = +(iso.match(/([\d.]+)H/) || [, 0])[1];
  const m = +(iso.match(/([\d.]+)M/) || [, 0])[1];
  const s = +(iso.match(/([\d.]+)S/) || [, 0])[1];
  return h * 3600 + m * 60 + s;
}
function activityTimeMs(name) {
  const pre = name.split('_PT')[0];
  const ms = Date.parse(pre.replace(/_/g, ':'));
  if (!Number.isNaN(ms)) return ms;
  const d = name.match(/^(\d{4}-\d{2}-\d{2})/);
  return d ? Date.parse(d[1]) : NaN;
}
function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
function nearestIdx(xs, t) {
  if (!xs?.length) return -1;
  let lo = 0, hi = xs.length - 1;
  if (t <= xs[0]) return 0;
  if (t >= xs[hi]) return hi;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m] < t) lo = m + 1; else hi = m - 1; }
  return (xs[lo] - t) < (t - xs[lo - 1]) ? lo : lo - 1;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dateStr = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const tick = () => new Promise((r) => setTimeout(r));
function setStatus(m) { el('status').textContent = m; }
