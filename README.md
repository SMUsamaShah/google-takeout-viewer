# Google Takeout Viewer

A modular, plain HTML/JS viewer for exploring data exported via [Google Takeout](https://takeout.google.com/). No build step — open `index.html` in a browser and pick your extracted Takeout folder; nothing is uploaded, everything runs locally.

## Current focus: health data

The first target is **Google Fit / Google Health** data. v1 charts heart rate and speed from the `Takeout/Fit/All Data/` JSON files, overlaid on a shared time axis, with any other data type in that folder (steps, distance, weight, …) selectable too.

## Usage

1. Extract your Takeout `.zip` locally.
2. Open `index.html` in a browser (Chromium-based recommended).
3. Click **Choose Takeout folder** and select the extracted folder.
4. Heart rate and speed load automatically; tick other files to overlay them. Scroll to zoom, drag to select a range, double-click to reset — zooming reveals the raw, non-aggregated samples.

## Design

Each Takeout data type is handled by a small parser module that turns its file format into a common time-series shape (two typed arrays: time and value). Adding support for a new type means adding one parser file. See **`spec.md`** for the data model and behaviour, and **`decisions.md`** for the architecture decision log.

```
index.html
core/      registry (parser lookup), align (union timeline for overlay)
parsers/   fit-datapoints.js — the Fit "All Data" JSON parser
ui/        loader, chart (uPlot), app (wiring)
```

## Status

Early but working for Fit `All Data` (heart rate, speed, and other same-schema types). Not yet handled: TCX activities, session files, CSV daily metrics, and the `Google Health/*` folders (SpO2, sleep, stress, etc.). See `spec.md` for the full list.
