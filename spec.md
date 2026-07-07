# spec.md — Google Takeout Viewer

Source of truth for what the app is and how it behaves. Keep this current when behaviour changes.

## Purpose

A plain HTML/JS (no build step) viewer for locally-held Google Takeout exports. Runs entirely
in the browser; no upload, no server. Current scope: **health data** (Google Fit / Google Health).
Two views over one folder load:

- **Chart** — scalar time series (heart rate, speed, …) overlaid on a shared time axis.
- **Map** — a GPS activity drawn on OpenStreetMap, its line coloured by a chosen series.

## Supported input (v1)

### Fit "All Data" JSON — `Takeout/Fit/All Data/{raw|derived}_com.google.<type>_<source>.json`
All share one schema:

```json
{ "Data Source": "<id>",
  "Data Points": [
    { "fitValue": [ { "value": { "fpVal": 68 } } ],
      "startTimeNanos": 1783031299000000000,
      "dataTypeName": "com.google.heart_rate.bpm" } ] }
```

- Value key is `fpVal` (continuous) or `intVal` (counts); parser reads whichever is present.
- `startTimeNanos` exceeds 2^53, so JSON.parse loses sub-second precision — harmless at ≥1s.
- One file = one series. Merge files are **not** time-ordered, so the parser sorts.

### TCX activities — `Takeout/Fit/Activities/*.tcx` (Garmin XML)
Ordered `<Trackpoint>`s. In this export, `Position` (lat/lon) and `HeartRateBpm` **never share a
trackpoint** — they interleave. So a track's GPS path and any scalar values are separate streams,
combined later by timestamp. Only ~925 of ~2,400 activities contain GPS.

### ECG readings — `Takeout/Google Health/Atrial Fibrillation ECG/afib_ecg_reading_<epochMs>.csv`
One reading per file: a header row + one data row. `waveform_samples` is a bracketed,
whitespace-separated integer array (raw ADC counts). 7,500 samples span 30 s = **250 Hz**. Metadata
includes `result_classification` (NSR, atrial fibrillation, high/low HR, inconclusive, unclassifiable),
`heart_rate` and device. The sample rate and any mV calibration are **not** in the export.

## Data model

**Series** (scalar time series):
```
{ id, dataType, label, unit, xs: Float64Array /*sec, ascending*/, ys: Float64Array }
```
Full resolution, no stored aggregation — zooming reveals raw samples.

**Track** (GPS path):
```
{ id, sport, start, end, t, lat, lon, alt }   // parallel Float64Arrays, one per GPS point
```

**ECGReading** (waveform):
```
{ id, timeMs, classification, heartRate, device, sampleRate, samples: Float64Array }
```

## UI model

The app is organised around *what you want to look at*, not file formats. There are **no view
tabs**: the main area follows your selection, and a heading names what you are looking at.

The sidebar has three sections:
- **Metrics** — one row per metric type (not one per file). A metric may come from several device
  files; they collapse to a single entry backed by the largest (most complete) file. Tick to show
  on the chart (multiple can overlay).
- **ECG** — one row per reading (newest first). Click to view its waveform.
- **Activities** — one row per TCX activity (newest first). Click to view its GPS track on the map.

Selecting from a section switches the view: tick a metric → chart, click an ECG reading → ECG
strip, click an activity → map.

## Flow

1. Pick the extracted Takeout folder (`<input webkitdirectory>`). Nothing is read yet.
2. The sidebar populates. Metric rows are derived from filenames (collapsed per type); activity and
   ECG rows are labelled from their filenames. Files are read only when selected.
3. Heart rate shows on the chart by default; speed also parses quietly so the map can colour by it.
4. Ticking a metric parses its file once (cached) and adds/overlays it on the chart.
5. Clicking an activity parses that TCX and, if it has GPS, shows it on the map.
6. Clicking an ECG reading parses that CSV and shows its waveform.

## Chart

uPlot (CDN global). One line per series; series grouped onto y-axes by unit (first two units get
left/right axes). Wheel zooms toward cursor, drag selects, double-click resets. Different series
sample times are unified via a union timeline with `NaN` gaps (`core/align.js`) — no resampling.
The default view shows a single metric (heart rate); overlaying metrics with different units and
time spans is opt-in, since it is only legible once zoomed in. Each metric charts from its largest
(most complete / merged) file; per-device drill-down is a possible later addition.

## Map

Leaflet + OpenStreetMap tiles; the track line is coloured by `leaflet-hotline`
(green→amber→red across the value range). The colour value is produced by **time-joining** the
track's timestamps against a selected Series (`core/timejoin.js`, nearest sample by binary
search, NaN beyond a 120 s gap). A "colour by" dropdown lists loaded scalar series (default heart
rate). NaN gaps are carry-filled so the ramp stays continuous; a track with no nearby colour data
is drawn as a plain line.

## ECG

A dedicated uPlot instance (non-time x-axis) plots amplitude (raw ADC) vs time in seconds; vertical
gridlines every 0.2 s give the standard ECG time reference. Wheel/drag zoom inspects individual
beats. The reading's classification, heart rate, device and duration are shown alongside. Amplitude
is raw ADC counts — the export carries no mV calibration.

## Extending to a new data type

Add one file in `parsers/` exporting `{ match(name), parse(text, name) -> Series[] }` and call
`register(...)`. The Fit "All Data" parser already covers every scalar type in that folder.

## Known limitations / caveats

- Colouring GPS by any metric always needs a time-join (GPS and HR never co-occur per point).
- Heart-rate data begins June 2021, so GPS activities before then can't be HR-coloured (they fall
  back to a plain line). Speed-from-GPS is a possible future colour source for those.
- GPS can be sparse within a track (some tracks have a point only every ~100 m); the line is coarse.
- Activities are listed from filenames without reading them, so a clicked activity may turn out to
  have no GPS — handled with a message. (Detecting GPS up front would mean reading all ~2,400.)
- `merge_speed` includes driving/cycling (seen to ~22 m/s), not just walking.
- ≥3 chart units share two y-axes and can overlap. Parsing a 60–75 MB merge file blocks the main
  thread ~0.5–1 s (status shown; a Web Worker is the future fix).
- ECG amplitude is uncalibrated raw ADC (no mV in export); the 250 Hz rate is the documented
  device rate, not stated in the files. Only `afib_ecg_reading_*.csv` is read; the equivalent
  consolidated `EcgUserData.csv` (comma-separated waveform) is ignored to avoid duplicate readings.
- Not yet handled: `All Sessions/*.json`, CSV daily metrics, and the rest of `Google Health/*`
  (SpO2, sleep, stress, temperature, etc.).
- The second Takeout zip (`archive_browser.html`) is a real manifest (every filename grouped by
  folder, plus per-product counts and total sizes) but is not parsed: the folder scan already
  yields the same files with sizes and their contents. An overview (counts/sizes) is derived from
  the scan instead (see decisions.md #20).
