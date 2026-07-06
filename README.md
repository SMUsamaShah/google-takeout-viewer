# Google Takeout Viewer

A modular, plain HTML/JS viewer for exploring data exported via [Google Takeout](https://takeout.google.com/). No build step — open `index.html` in a browser (Chromium-based recommended) and load your export files directly; nothing is uploaded anywhere.

## Current focus: health data

The first target is **Google Fit / Health data** from a Takeout export — heart rate, walking pace/steps, sleep sessions, and similar time-series data, which Takeout splits across many JSON and CSV files with inconsistent schemas per data type.

Goals for this phase:
- Parse the various Fit/Health file formats into a single, consistent time-series shape
- Chart data types like heart rate and walking pace overlaid on a shared time axis
- Handle large numbers of files/points without choking the browser

## Design

The app uses a plugin-per-data-type architecture: each Takeout data type (heart rate, pace, sleep, etc.) gets its own small parser module that knows how to turn that file format into a common `{ t, v }` time-series shape. Adding support for a new data type later means adding one new parser file, not touching the rest of the app.

See `spec.md` for the current data model and file conventions, and `decisions.md` for the architecture decision log.

## Status

Early scaffolding. Health/Fit data is the only supported category so far; other Takeout data types (e.g. location, activity) may be added later using the same plugin pattern.
