# decisions.md — architecture decision records

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
