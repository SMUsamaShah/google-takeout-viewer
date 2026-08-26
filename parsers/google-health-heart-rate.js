// Parser for the newer Google Health heart-rate export:
//   Takeout/Google Health/Physical Activity_GoogleData/heart_rate_YYYY-MM-DD.csv
//
// Unlike the Google Fit JSON merge, these files are split by day and contain the
// watch's high-resolution readings. The application combines the daily series in
// ui/app.js, so this parser deliberately handles one file at a time.

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

export const googleHealthHeartRateParser = {
  match(name) {
    return /^heart_rate_\d{4}-\d{2}-\d{2}\.csv$/i.test(name);
  },

  parse(text, name) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    const header = parseCsvLine(lines[0]);
    const timestampAt = header.indexOf('timestamp');
    const bpmAt = header.indexOf('beats per minute');
    if (timestampAt < 0 || bpmAt < 0) return [];

    const xs = [], ys = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const t = Date.parse(row[timestampAt]);
      const v = Number(row[bpmAt]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      xs.push(t / 1000);
      ys.push(v);
    }
    if (!xs.length) return [];

    // A daily file is normally ordered, but sorting costs little and makes the
    // parser safe for hand-edited exports and the binary-search consumers.
    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const sx = new Float64Array(order.length);
    const sy = new Float64Array(order.length);
    for (let i = 0; i < order.length; i++) {
      sx[i] = xs[order[i]];
      sy[i] = ys[order[i]];
    }

    return [{
      id: `google-health:${name}`,
      dataType: 'com.google.heart_rate.bpm',
      label: 'Heart rate',
      unit: 'bpm',
      source: 'Google Health / Pixel Watch',
      xs: sx,
      ys: sy,
    }];
  },
};

register(googleHealthHeartRateParser);
