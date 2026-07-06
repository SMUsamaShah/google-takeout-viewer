# decisions.md — architecture decision records

Newest first. Each entry: the decision, why, and what was rejected.

## 15. Map = Leaflet + OpenStreetMap + leaflet-hotline
Leaflet with OSM tiles needs no API key and is fully open; `leaflet-hotline` colours a polyline by
a per-point value, which is exactly the "colour the track by heart rate/speed" ask. All three load
from CDN (no build step). A per-segment hand-coloured polyline was the fallback; the plugin is less
code and purpose-built.

## 14. Colour tracks by time-join, not by co-located values
Verified across all 925 GPS activities: GPS and heart rate are **never** on the same trackpoint. So
for each GPS point we look up the nearest-in-time value in a chosen Series (binary search,
`core/timejoin.js`), NaN beyond 120 s. This reuses the existing Series type, works for any metric
the user selects (not just HR), and decouples "does this file contain HR" from "can we colour by HR".

## 13. Track is a separate type from Series
A GPS path (2-D, lat/lon over time) is not a scalar time series, so it gets its own struct of
parallel Float64Arrays rather than being forced into Series. Scalar streams found inside a TCX
(e.g. its HR trackpoints) are still returned as Series so they can be charted or joined.

## 12. TCX parsed with the browser DOM; JSON merge files parsed manually
TCX activity files are small (one activity), so `DOMParser` is fine and simplest. The 60–75 MB Fit
JSON files are extracted straight into typed arrays instead (no DOM, no array-of-objects) because
size makes allocation the bottleneck there.

## 11. Activities listed from filenames, parsed on click
The filename encodes date, ISO-8601 duration and sport, so the ~2,400-activity list is built
without reading any file. GPS presence isn't in the filename and detecting it means reading the
file, so that check happens on click. Reading all activities up front just to filter was rejected
as too costly for the benefit.


Newest first. Each entry: the decision, why, and what was rejected.

## 10. Sort each series at parse time
The merge files are **not** chronologically ordered (verified: first array entry July 2026,
a later entry June 2022). uPlot and the union alignment both require ascending x. So the parser
checks order in one pass and, only if needed, index-sorts and gathers into fresh arrays. The
"check first" avoids the sort allocation for already-ordered files. Discovered by testing the
parser against the real 63 MB heart-rate file, not assumed.

## 9. Union timeline + NaN gaps for overlaying series
Heart rate and speed have different sample timestamps, but uPlot requires one shared x array.
We take the union of all timestamps and fill each series into it, `NaN` where absent. Chosen over
resampling onto a fixed grid because resampling would destroy raw values (and the whole point is
zoom-to-raw). `NaN` (not `null`) works because uPlot's numeric ranging ignores `NaN`
(`NaN < min` / `NaN > max` are both false) and draws it as a gap, so we keep everything in
`Float64Array` with no boxed `null`s.

## 8. Full-resolution typed arrays, no stored aggregation
Each series is two `Float64Array`s. No downsampling/bucketing layer is stored. Requirement was
explicit: zoom must reveal non-aggregated data. Keeping raw arrays and letting uPlot clip to the
visible range makes zoom-to-raw automatic **and** is less code than an aggregation pipeline that
we'd then have to invert on zoom. If wide-zoom drawing (~400k points) proves janky, the escape
hatch is min/max decimation keyed to canvas pixel width — deferred until measured, not built now.

## 7. Default selection = largest file per type
Per data type there are several files (one per device) plus a merged superset. The merged file
isn't identifiable from its (truncated) filename, but it's always the largest. So we pick the
largest file per type by `File.size` — available as metadata without reading content. Avoids
parsing several 60 MB files just to decide which to show.

## 6. Lazy parsing, cached
Selecting a folder reads nothing. A file is parsed only when its series is first shown, then
cached by name. Keeps folder selection instant and memory bounded to what's actually charted
(parsing all ~280 All Data files eagerly would be 700 MB+).

## 5. webkitdirectory input, not the File System Access API (yet)
The viewer only needs read access, and `<input webkitdirectory>` gives that with file sizes for
free, one code path, and broad browser support. The File System Access API's advantage is
**persistence** (remember the folder, skip re-picking) — worth adding later, but not needed for a
working v1, and it would add a second code path and narrow support to Chromium.

## 4. Value key handled as fpVal-or-intVal
Continuous types use `fpVal`, counts use `intVal` (verified across heart_rate/speed/step_count).
Parser reads whichever is present rather than branching per data type.

## 3. One parser for the whole Fit "All Data" folder
Every file in that folder shares the `Data Points` schema, so a single parser handles all types.
The plugin registry still exists for genuinely different formats added later (TCX, CSV, Health/*).

## 2. uPlot for charting
Tiny, no build step (single global script), and built for dense time series — it handles the
200k+ points/series this export produces. Chart.js was rejected: it bogs down at this density.

## 1. Vanilla ES modules, no build step
`<script type="module">` with relative imports; uPlot as a CDN global. No bundler/toolchain to
maintain. Matches the "simple, minimal code" constraint and the no-build-step requirement.
