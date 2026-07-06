# spec.md — Google Takeout Viewer

Source of truth for what the app is and how it behaves. Keep this current when behaviour changes.

## Purpose

A plain HTML/JS (no build step) viewer for locally-held Google Takeout exports. Runs entirely
in the browser; no upload, no server. Current scope: **health data** (Google Fit / Google Health),
starting with heart rate and speed, overlaid on a shared time axis.

## Supported input (v1)

Files under `Takeout/Fit/All Data/` named `{raw|derived}_com.google.<type>_<source>.json`.
All share one schema:

```json
{ "Data Source": "<id>",
  "Data Points": [
    { "fitValue": [ { "value": { "fpVal": 68 } } ],
      "startTimeNanos": 1783031299000000000,
      "dataTypeName": "com.google.heart_rate.bpm" }
  ] }
```

- Value key is `fpVal` (continuous) or `intVal` (counts); parser reads whichever is present.
- `startTimeNanos` is nanosecond epoch. It exceeds 2^53, so JSON.parse loses sub-second
  precision — harmless, we chart at ≥ 1s resolution.
- One file = one series (one `Data Source`).

Known present types include: heart_rate.bpm, speed, step_count.delta, distance.delta,
calories.expended, weight, respiratory_rate, active_minutes. Unmapped types still load,
labelled by their raw type name.

## Data model

A **Series** is:

```
{ id, dataType, label, unit, xs: Float64Array, ys: Float64Array }
```

- `xs` = unix timestamps in **seconds** (uPlot's native time unit), strictly ascending.
- `ys` = values, same length as `xs`.
- Full resolution is kept in memory. **No aggregation is stored**, so zooming in shows the
  original raw samples.

## Flow

1. User picks their extracted Takeout folder (`<input webkitdirectory>`).
2. Files are listed but **not read**. Only those matching a registered parser are shown,
   grouped by type, each with its `raw`/`derived` kind and size.
3. Heart rate + speed are auto-selected — the **largest file per type**, which is the merged
   (deduplicated, most-complete) series. Chosen by file size alone, without parsing.
4. Ticking a file parses it once (cached) and adds it to the chart. Unticking removes it.

## Alignment (multi-series overlay)

uPlot needs all series on one shared x array. `core/align.js` builds the **union** of every
selected series' timestamps and fills each series' values into it, leaving `NaN` where a series
has no sample (uPlot renders `NaN` as a gap and ignores it when ranging the y-axis). Raw values
are preserved exactly — no resampling.

## Chart

- Library: uPlot (loaded from CDN as a global).
- One line per series. Series are grouped onto y-scales/axes **by unit**; the first two units
  get left/right axes. (≥ 3 units currently overlap on those two sides — see limitations.)
- Zoom: mouse wheel zooms toward the cursor; drag selects a range; double-click resets to full.
  Zooming reveals raw points because nothing is aggregated.

## Extending to a new data type

Add one file in `parsers/` exporting `{ match(name), parse(text, name) -> Series[] }` and call
`register(...)`. Nothing else changes. The Fit `All Data` parser already covers every type in
that folder via the shared schema.

## Known limitations / caveats

- `merge_speed` includes all movement (observed up to ~22 m/s / 80 km/h), i.e. driving and
  cycling too — not just walking. A walking-only pace view needs filtering by activity segment
  or the `All Sessions` WALKING files (future).
- Pace (min/km) is a trivial transform of speed but not yet exposed; zero-speed samples make it
  undefined, so it needs handling before charting.
- ≥ 3 distinct units share the two available y-axes and can overlap.
- Parsing a 60–75 MB merge file blocks the main thread ~0.5–1 s. Acceptable with a status line;
  a Web Worker is the future fix.
- Not yet handled: `Fit/Activities/*.tcx`, `All Sessions/*.json`, CSV daily metrics,
  and the `Google Health/*` folders (SpO2, sleep, stress, etc.).
