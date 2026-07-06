// Parser for Google Fit "All Data" export files:
//   Takeout/Fit/All Data/{raw|derived}_com.google.<type>_<source>.json
//
// All of these share one schema, so this single parser covers every data type in
// that folder (heart rate, speed, steps, weight, ...):
//
//   { "Data Source": "<id>", "Data Points": [
//       { "fitValue":[{"value":{"fpVal":68}}], "startTimeNanos": 1783031299000000000, ... }
//   ]}
//
// Value key is "fpVal" for continuous types and "intVal" for counts; we read whichever
// is present. Timestamps are nanosecond epoch; note they exceed 2^53 so JSON.parse loses
// sub-second precision, which is harmless because we chart at >= 1s resolution.

import { register } from '../core/registry.js';

// Friendly label + unit per known dataType. Unknown types still parse, labelled by type.
const META = {
  'com.google.heart_rate.bpm':    { label: 'Heart rate',      unit: 'bpm' },
  'com.google.speed':             { label: 'Speed',           unit: 'm/s' },
  'com.google.step_count.delta':  { label: 'Steps',           unit: 'steps' },
  'com.google.distance.delta':    { label: 'Distance',        unit: 'm' },
  'com.google.calories.expended': { label: 'Calories',        unit: 'kcal' },
  'com.google.weight':            { label: 'Weight',          unit: 'kg' },
  'com.google.respiratory_rate':  { label: 'Respiratory rate', unit: '/min' },
  'com.google.active_minutes':    { label: 'Active minutes',  unit: 'min' },
};

function meta(dataType) {
  return META[dataType] || { label: dataType.replace('com.google.', ''), unit: '' };
}

export const fitDataPointsParser = {
  match(name) {
    return /^(raw|derived)_com\.google\..+\.json$/i.test(name);
  },

  parse(text, name) {
    const doc = JSON.parse(text);
    const pts = doc['Data Points'];
    if (!Array.isArray(pts) || pts.length === 0) return [];

    const n = pts.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let w = 0;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const fv = p.fitValue;
      if (!fv || fv.length === 0) continue;
      const v = fv[0].value;
      const y = v.fpVal !== undefined ? v.fpVal : v.intVal;
      if (y === undefined || y === null) continue;
      xs[w] = p.startTimeNanos / 1e9; // nanos -> seconds
      ys[w] = y;
      w++;
    }

    // Merge files are not chronologically ordered, but uPlot (and our alignment)
    // require ascending timestamps. Sort by index, then gather into fresh arrays.
    let sx = xs.subarray(0, w);
    let sy = ys.subarray(0, w);
    let sorted = true;
    for (let i = 1; i < w; i++) { if (sx[i] < sx[i - 1]) { sorted = false; break; } }
    if (!sorted) {
      const idx = new Uint32Array(w);
      for (let i = 0; i < w; i++) idx[i] = i;
      idx.sort((a, b) => sx[a] - sx[b]);
      const ox = new Float64Array(w);
      const oy = new Float64Array(w);
      for (let i = 0; i < w; i++) { ox[i] = sx[idx[i]]; oy[i] = sy[idx[i]]; }
      sx = ox; sy = oy;
    }

    const dataType = pts[0].dataTypeName || '';
    const m = meta(dataType);
    return [{
      id: doc['Data Source'] || name,
      dataType,
      label: m.label,
      unit: m.unit,
      xs: sx,
      ys: sy,
    }];
  },
};

register(fitDataPointsParser);
