// Parser for Google Health's per-second activity classifier:
//   Takeout/Google Health/Health Fitness Data_GoogleData/UserActivityProbabilities_YYYY-MM-DD.csv
//
// These are probabilities, not confirmed workout records. Keep only the top three classes per
// interval and load one day lazily when the user pins a moment on the timeline.

const LABELS = [
  'Still', 'Walking', 'Running', 'Outdoor cycling', 'Indoor cycling',
  'Elliptical', 'Rowing machine', 'Vehicle', 'Unknown', 'Gym',
];
const TYPES = new Map([
  ['STILL', 0], ['WALKING', 1], ['RUNNING', 2], ['OUTDOOR_CYCLING', 3],
  ['INDOOR_CYCLING', 4], ['ELLIPTICAL', 5], ['ROWING_MACHINE', 6],
  ['VEHICLE_ROAD', 7], ['UNSPECIFIED', 8], ['GYM', 9],
]);

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

function topThree(value) {
  const best = [[-1, -1], [-1, -1], [-1, -1]];
  const re = /ACTIVITY_PROBABILITY_TYPE_([A-Z0-9_]+)\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(value))) {
    const type = TYPES.get(m[1].toUpperCase());
    const probability = Number(m[2]);
    if (type === undefined || !Number.isFinite(probability)) continue;
    for (let i = 0; i < best.length; i++) {
      if (probability <= best[i][1]) continue;
      best.splice(i, 0, [type, probability]);
      best.pop();
      break;
    }
  }
  return best;
}

export const googleHealthActivityParser = {
  match(name) {
    return /^UserActivityProbabilities_\d{4}-\d{2}-\d{2}\.csv$/i.test(name);
  },

  parse(text, name) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const header = parseCsvLine(lines[0]);
    const startAt = header.indexOf('activity_probabilities_start');
    const endAt = header.indexOf('activity_probabilities_end');
    const probabilitiesAt = header.indexOf('activity_probabilities');
    if (startAt < 0 || endAt < 0 || probabilitiesAt < 0) return null;

    const starts = new Float64Array(lines.length - 1);
    const ends = new Float64Array(lines.length - 1);
    const types = new Uint8Array((lines.length - 1) * 3);
    const probabilities = new Float32Array((lines.length - 1) * 3);
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const start = Date.parse(row[startAt]) / 1000;
      const end = Date.parse(row[endAt]) / 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const top = topThree(row[probabilitiesAt] || '');
      if (top[0][0] < 0) continue;
      starts[n] = start;
      ends[n] = end;
      for (let j = 0; j < 3; j++) {
        types[n * 3 + j] = top[j][0] < 0 ? 8 : top[j][0];
        probabilities[n * 3 + j] = top[j][1] < 0 ? 0 : top[j][1];
      }
      n++;
    }
    if (!n) return null;
    return {
      source: name,
      starts: starts.subarray(0, n), ends: ends.subarray(0, n),
      types: types.subarray(0, n * 3), probabilities: probabilities.subarray(0, n * 3),
      count: n,
    };
  },

  lookup(data, t, maxGapSec = 10) {
    if (!data?.count || !Number.isFinite(t)) return null;
    let lo = 0, hi = data.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (data.starts[mid] <= t) lo = mid + 1;
      else hi = mid - 1;
    }
    const candidates = [];
    if (hi >= 0) candidates.push(hi);
    if (lo < data.count) candidates.push(lo);
    let best = -1, distance = Infinity;
    for (const i of candidates) {
      const d = t < data.starts[i] ? data.starts[i] - t
        : t > data.ends[i] ? t - data.ends[i] : 0;
      if (d < distance) { distance = d; best = i; }
    }
    if (best < 0 || distance > maxGapSec) return null;
    const choices = [];
    for (let j = 0; j < 3; j++) {
      const p = data.probabilities[best * 3 + j];
      if (p > 0) choices.push({ label: LABELS[data.types[best * 3 + j]], probability: p });
    }
    return { start: data.starts[best], end: data.ends[best], choices, distance };
  },
};
