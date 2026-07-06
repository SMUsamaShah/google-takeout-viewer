// Map view. Draws a GPS track on OpenStreetMap tiles (Leaflet) and colours the line by a
// per-point value using leaflet-hotline (green -> amber -> red across the value's range).
//
// Values come pre-joined (core/timejoin.js) and may contain NaN where no colour data was
// near enough in time. We carry the last valid value across those gaps so the line stays
// continuous; if there is no colour data at all, we draw a plain line instead.
//
// Returns { colored, min, max } so the caller can show a legend line.

let map = null, layer = null;

export function renderMap(container, track, values, palette) {
  if (!map) {
    map = L.map(container);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
  }
  map.invalidateSize(); // container may have been hidden when created
  if (layer) { map.removeLayer(layer); layer = null; }

  const v = fillGaps(values);
  let min = Infinity, max = -Infinity;
  for (const x of v) { if (!Number.isNaN(x)) { if (x < min) min = x; if (x > max) max = x; } }
  const colored = min !== Infinity;

  if (!colored) {
    const pts = [];
    for (let i = 0; i < track.lat.length; i++) pts.push([track.lat[i], track.lon[i]]);
    layer = L.polyline(pts, { color: '#2e86ab', weight: 4 }).addTo(map);
  } else {
    const latlngs = [];
    for (let i = 0; i < track.lat.length; i++) latlngs.push([track.lat[i], track.lon[i], v[i]]);
    layer = L.hotline(latlngs, {
      min, max, weight: 5, outlineWidth: 1, outlineColor: '#00000022',
      palette: palette || { 0.0: '#2e86ab', 0.5: '#f6c445', 1.0: '#d1495b' },
    }).addTo(map);
  }
  map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  return { colored, min, max };
}

// Carry-forward/backward fill so NaNs don't break the colour ramp.
function fillGaps(values) {
  const v = Float64Array.from(values);
  let last = NaN;
  for (let i = 0; i < v.length; i++) { if (Number.isNaN(v[i])) v[i] = last; else last = v[i]; }
  last = NaN;
  for (let i = v.length - 1; i >= 0; i--) { if (Number.isNaN(v[i])) v[i] = last; else last = v[i]; }
  return v;
}
