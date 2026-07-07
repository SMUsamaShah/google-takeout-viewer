# requirements.md — what I want from this app

My goals for the Google Takeout Viewer. spec.md describes how it currently works; this file
is the "why" and the target, and should be kept in sync as goals evolve.

## Core intent

- View my own **Google Takeout health data** locally in the browser. No upload, no server,
  no build step. Just open `index.html` and point it at my extracted Takeout folder.
- **Modular and extensible**: I'll export more data types over time. Adding support for a new
  type should mean dropping in one small parser, not reworking the app.

## What I want to see

- **Metrics over time** (chart): heart rate, walking pace/speed, and other scalar metrics.
  Overlay more than one on a shared time axis. I must be able to **zoom in and see the raw,
  non-aggregated data**, not just a smoothed/bucketed overview.
- **GPS activities on a map** (OpenStreetMap): if an activity has GPS, show the walk/ride as a
  line on the map. Colour the line by **heart rate, speed, or any metric I choose**, so I can
  see, say, where my heart rate was highest along the route.
- **ECG readings**: view the single-lead ECG waveform from a reading, with its classification
  and heart rate.

## How the UI should feel

- Organised around **what I want to view**, not around file formats. I think in metrics
  ("heart rate", "steps"), not in individual device files.
- One row per metric, with readable names — not a wall of identical `derived · N MB` rows.
- Don't make me pick a "mode" for everything: selecting a metric / activity / ECG reading should
  just show the right view.

## How I want it built

- Simple over clever. More code = more technical debt.
- Avoid unnecessary memory allocations (this data gets large — 200k+ points per metric).
- Plain HTML/JS with libraries allowed, but no build step / toolchain.
- Keep `requirements.md`, `spec.md`, and `decisions.md` current as the app changes.
