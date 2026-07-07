# decisions.md — architecture decision records

Newest first. Each entry: the decision, why, and what was rejected.

## 26. Gap padding is `null`, not `NaN` — corrects ADR 9
ADR 9 padded the union timeline with `NaN` and reasoned it was safe because "uPlot's numeric
ranging ignores NaN (`NaN < min` / `NaN > max` are both false)". That reasoning is wrong. uPlot
ranges a y-scale by **seeding** its running min/max with the first in-view sample, then folding in
the rest with `min > v ? min = v : v > max && (max = v)`. When that first sample is `NaN`, the
seed is `NaN`, and every later comparison (`NaN > v` and `v > NaN`) is false, so nothing updates —
the scale gets **no range** and the whole series *and its axis* disappear.

This produced two user-visible bugs, both from the same cause:
- **Overlay:** selecting heart rate (data from 2021) + steps (from 2015) put the union's left edge
  in 2015, so heart rate's first column value was padding — heart rate never ranged and only steps
  drew.
- **Zoom:** whether a scale's first *visible* sample was real or padding flipped as you zoomed, so
  lines blinked out and back.

Fix: pad with `null`, uPlot's actual "missing" sentinel, which its scan skips (so the seed is the
first real value). `null` can't live in a `Float64Array`, so the aligned overlay **columns** are
now plain `Array`s; the raw per-series arrays stay `Float64Array`. Verified against the real 201k-pt
heart-rate and 240k-pt steps files: both overlay and a full zoom sweep now range every scale that
has data in view. Rejected: keeping `NaN` and adding a custom per-scale `range` callback that
re-scans the data ourselves — more code, and it reimplements the auto-ranging that `null` restores
for free.

## 25. Don't parse archive_browser.html, but it is a real manifest (corrected)
A Takeout download ships two zips: the data, and a small one holding only
`Takeout/archive_browser.html`. **Correction to an earlier wrong finding:** that page *does*
contain a complete manifest — every filename (8,767 nodes here) grouped by folder — plus
per-product counts and total sizes (Fit 8,173 files / 766.3 MB, Google Health 594 / 153.2 MB).
The earlier "no manifest" claim came from a bad check: `grep -c` counts matching *lines*, and the
HTML is minified onto one line, so it reported 1; filenames also sit in `extracted-file-name` text
nodes, not `href`s, so an href scan found none.

We still don't parse it, for a sound reason this time: the `webkitdirectory` scan already
enumerates every file **with sizes** and gives access to the file *contents* we need to chart;
the manifest has names only (no per-file sizes/dates, no data-level info, no working links). So it
is strictly redundant as a data source. The one idea worth taking from it — a per-product/per-type
**overview** (counts + sizes) — is computed from our own scan, not by parsing Google's HTML.

## 24. Event markers on the timeline (activities, ECG)
To move toward the aggregate-timeline goal, activities and ECG readings render as clickable ticks
at the top of the chart, on the same time axis as the metrics. Times come from filenames (no file
read); clicking a tick opens the existing map/ECG detail view. Kept as a thin draw-hook + click
hit-test rather than a separate lane widget — smallest step that puts "all data on one timeline".

## 23. spanGaps: true — overlaying metrics must add data, not remove it
The union timeline (ADR 9) pads each series with NaN at the other series' timestamps. With
`spanGaps: false`, uPlot broke the line at every NaN, so adding speed shattered heart rate into
5,221 fragments (measured) — the user saw *less* data with more boxes checked. Set `spanGaps: true`
so each line bridges the padding NaNs and stays whole. Known tradeoff: genuine long gaps are also
bridged by a straight segment; acceptable for now, and separate from this bug.

## 22. Type key by known-prefix match, not underscore split
A data type (e.g. `step_count.cumulative`) and the source that follows it both contain
underscores, so the type/source boundary is ambiguous from the filename. Splitting on `_` mislabels
files whose source is a device name (`..._motorola_`) rather than `com...`. So the type is found by
matching known data-type prefixes, with a first-token fallback for unknown types.

## 21. No view tabs — the view follows selection
Chart/Map/ECG tabs were always shown even when irrelevant, presenting three modes for everything.
Removed them: ticking a metric shows the chart, clicking an activity shows the map, clicking an ECG
reading shows the strip; a heading names the current view. Less chrome, and navigation matches how
the data is actually chosen.

## 20. Sidebar lists one row per metric, not per file
The per-file list was unreadable at scale: every row showed only `derived · N MB`, and near-empty
per-session files (e.g. ~30 activity-samples) buried the Activities and ECG sections. Files now
collapse to one entry per metric type (backed by the largest file), with readable names. Rejected:
reading every file up front to group by its true `dataTypeName` — too costly; filename-based
grouping with a known-type list is enough.

## 19. Chart defaults to a single metric (heart rate)
Auto-showing heart rate *and* speed produced an unreadable first view: two different-unit scales
overlaid across ~11 years (speed data starts 2015, heart rate 2021), with speed's GPS glitches
(up to 78 m/s) stretching its axis so normal values flatten. The fix is a default, not new
machinery: parse both (speed is still needed as a map colour source) but only tick heart rate on
the chart. Overlaying speed is one click away. Rejected as over-engineering: outlier clamping /
percentile y-ranges — that hides real (if glitchy) data and adds cleverness for a default-view issue.

## 18. ECG rendered with a dedicated non-time uPlot, not chart.js
An ECG strip is one waveform with an x-axis in seconds-from-start, not epoch time, and no union
alignment across series. Bending chart.js (built for multi-series epoch-time overlay) to fit would
be more code than a small dedicated renderer. ui/ecg.js reuses uPlot but with its own config.

## 17. Assume 250 Hz, plot raw ADC amplitude
The export includes neither a sample rate nor a mV calibration. 7,500 samples over a 30 s reading
is exactly 250 Hz, the documented rate for this device, so that constant is used to build the time
axis. Amplitude stays in raw ADC counts, labelled as such, rather than inventing a mV scale.

## 16. ECG source = afib_ecg_reading_*.csv, not EcgUserData.csv
The same readings appear in two shapes: individual `afib_ecg_reading_*.csv` files (one reading each,
whitespace-separated waveform) and a consolidated `EcgUserData.csv` (comma-separated waveform). The
individual files map cleanly to "one reading = one list item" and avoid parsing a second waveform
format, so they are the source; the consolidated file is ignored to prevent duplicate readings.

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
