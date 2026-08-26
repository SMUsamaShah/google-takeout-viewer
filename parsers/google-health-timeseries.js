// Parsers for Google Health's daily scalar exports, such as speed and steps.
// The loader merges these daily files with the historical Fit series.

import { register } from '../core/registry.js';

function parseCsvLine(line) {
  const fields = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      fields.push(field); field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

const META = {
  speed: { label: 'Speed / pace', unit: 'm/s', dataType: 'com.google.speed' },
  steps: { label: 'Steps', unit: 'steps', dataType: 'com.google.step_count.delta' },
};

export const googleHealthTimeseriesParser = {
  match(name) {
    return /^(speed|steps)_\d{4}-\d{2}-\d{2}\.csv$/i.test(name);
  },

  parse(text, name) {
    const kind = (name.match(/^(speed|steps)_/i) || [, ''])[1].toLowerCase();
    const m = META[kind];
    if (!m) return [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    const timeAt = header.indexOf('timestamp');
    const valueAt = header.indexOf(kind);
    if (timeAt < 0 || valueAt < 0) return [];
    const xs = [], ys = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const t = Date.parse(row[timeAt]);
      const value = Number(row[valueAt]);
      if (!Number.isFinite(t) || !Number.isFinite(value)) continue;
      xs.push(t / 1000); ys.push(value);
    }
    if (!xs.length) return [];
    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const sx = new Float64Array(order.length), sy = new Float64Array(order.length);
    for (let i = 0; i < order.length; i++) { sx[i] = xs[order[i]]; sy[i] = ys[order[i]]; }
    return [{ id: `google-health:${name}`, dataType: m.dataType, label: m.label, unit: m.unit,
      source: 'Google Health / Pixel Watch', xs: sx, ys: sy }];
  },
};

register(googleHealthTimeseriesParser);
