// Parser for Google Fit activity files: Takeout/Fit/Activities/*.tcx (Garmin TCX XML).
//
// A TCX holds ordered <Trackpoint>s. In this export, Position (lat/lon) and HeartRateBpm
// are NEVER on the same trackpoint - they interleave - so a track's GPS path and any
// scalar values are separate streams joined later by timestamp (see core/timejoin.js).
//
// Produces a Track (the GPS path) and, when present, scalar Series (e.g. heart rate) that
// can colour the path or be charted. Only trackpoints with a Position contribute to the path.
//
//   Track = { id, sport, start, end, t, lat, lon, alt }   // parallel Float64Arrays
//
// Parsing uses the DOM (browser-native, no XML lib, no build step). Files are small
// (one activity), so DOM parsing is fine here - unlike the 60 MB JSON merge files.

import { register } from '../core/registry.js';

function num(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? parseFloat(n.textContent) : NaN;
}

export const tcxParser = {
  match(name) {
    return /\.tcx$/i.test(name);
  },

  // Returns { track, series }. track may be null if the activity has no GPS.
  parseActivity(text, name) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const act = doc.getElementsByTagName('Activity')[0];
    const sport = act ? act.getAttribute('Sport') || 'Activity' : 'Activity';
    const tps = doc.getElementsByTagName('Trackpoint');

    const n = tps.length;
    const t = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n), alt = new Float64Array(n);
    let g = 0;
    // scalar HR stream (its own timestamps)
    const hrT = new Float64Array(n), hrV = new Float64Array(n);
    let h = 0;

    for (let i = 0; i < n; i++) {
      const tp = tps[i];
      const timeEl = tp.getElementsByTagName('Time')[0];
      if (!timeEl) continue;
      const sec = Date.parse(timeEl.textContent) / 1000;

      const pos = tp.getElementsByTagName('Position')[0];
      if (pos) {
        lat[g] = num(pos, 'LatitudeDegrees');
        lon[g] = num(pos, 'LongitudeDegrees');
        alt[g] = num(tp, 'AltitudeMeters');
        t[g] = sec;
        g++;
      }
      const hrEl = tp.getElementsByTagName('HeartRateBpm')[0];
      if (hrEl) {
        const v = parseFloat(hrEl.getElementsByTagName('Value')[0].textContent);
        if (!Number.isNaN(v)) { hrT[h] = sec; hrV[h] = v; h++; }
      }
    }

    const track = g > 0 ? {
      id: name, sport,
      start: t[0], end: t[g - 1],
      t: t.subarray(0, g), lat: lat.subarray(0, g), lon: lon.subarray(0, g), alt: alt.subarray(0, g),
    } : null;

    const series = [];
    if (h > 0) series.push({
      id: name + '#hr', dataType: 'com.google.heart_rate.bpm',
      label: 'Heart rate', unit: 'bpm', xs: hrT.subarray(0, h), ys: hrV.subarray(0, h),
    });

    return { track, series };
  },

  // registry's parse() contract returns Series[]; expose the scalar streams there.
  parse(text, name) {
    return this.parseActivity(text, name).series;
  },
};

register(tcxParser);
