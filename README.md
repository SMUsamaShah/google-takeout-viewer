# Health Timeline — Google Takeout Viewer

A modular, plain HTML/JS viewer for the health data in a [Google Takeout](https://takeout.google.com/) export. No build step — open `index.html`, pick your extracted Takeout folder; nothing is uploaded, everything runs locally in the browser.

It exists because the phone app only shows **5-minute aggregates**. The export contains the raw stream — on a Pixel Watch that's a sample every ~3 seconds — and this viewer plots it.

You can choose either the extracted Takeout folder or the original `.zip` directly. ZIP loading is
local: the browser indexes the archive and decompresses entries on demand, using worker-backed
ZIP decoding where supported. It does not create an extracted copy on disk.

## What it shows

An **aggregate timeline**: one lane per metric, stacked on a single shared time axis, with heart rate as the hero.

- **Heart rate at full resolution.** Every sample, not an average. Zoom from five years down to a minute.
- **Daily band for the long view.** A per-day min–max envelope with the daily average through it, so "how does this month compare with six months ago" is visible at a glance; zoom in and the raw samples take over.
- **Read any moment.** Move across the timeline and the inspector shows every selected metric at that instant, that day's resting and peak, and any activity or ECG reading around it. Click to pin.
- **Explain a heart-rate moment.** Pin a sample and the inspector lazily reads that day's Pixel Watch activity classifier, showing the most likely state (walking, running, still, vehicle, etc.) and its probability.
- **See speed and pace when exported.** Google Health speed files are merged with Fit history; the inspector also converts speed to a minutes-per-kilometre pace. A lane explicitly says when a selected metric has no samples in the current time window.
- **Activities and ECG on the same axis.** A ribbon under the lanes; click a block to open the GPS track, click an ECG tick to open the waveform — as a sheet over the timeline, so you keep your place.
- **Headline numbers, scoped to what you're looking at.** Resting heart rate (with the change against the preceding period), average, peak, and the sampling resolution of the window.
- Range presets, per-metric filter chips, a table view, and light/dark.

## Usage

1. Open `index.html` in a browser (Chromium-based recommended).
2. Click **Choose Takeout folder** or **Choose Takeout ZIP**.
3. Select the extracted folder or original Takeout archive.

Heart rate loads by default, opening on the most recent continuous stretch of data. Drag to pan, scroll to zoom, shift-drag to select a range, double-click to reset.

## Design

Each Takeout data type is handled by a small parser that turns its format into a common time-series shape (typed arrays of time and value). Adding support for a new type means adding one parser file. See **`spec.md`** for the data model and **`decisions.md`** for the architecture decision log — including why metrics get separate lanes rather than a shared second y-axis, and why heart rate is drawn in blue.

```
index.html      the shell: palette, layout, filters
core/           registry (parser lookup), align (shared timeline), timejoin (nearest-value)
parsers/        fit-datapoints (Fit "All Data" JSON), fit-daily (daily summary CSV),
                google-health-heart-rate (Pixel Watch daily CSVs), google-health-activity
                (activity probabilities), google-health-timeseries (speed and steps),
                tcx (activities),
                ecg (waveforms)
ui/             timeline (the lanes), stats (KPIs + table), inspector wiring in app,
                map (Leaflet track), ecg (waveform), loader, app (orchestration)
```

## Status

Working for Fit `All Data` (heart rate, steps, speed and other same-schema types), the Fit daily
activity summary, Google Health Pixel Watch heart-rate CSVs and speed/steps, TCX activities, and Pixel Watch /
Fitbit ECG readings. Not yet parsed: the remaining `Google Health/*` CSV folders (resting heart
rate from sleep, HRV, breathing rate, SpO2, sleep stages) and the Fit session files. See `spec.md`
for the full list.
