// Parser for single-lead ECG strips:
//   Takeout/Google Health/Atrial Fibrillation ECG/afib_ecg_reading_<epochMs>.csv
//
// One reading per file: a header row + one data row. The last field, waveform_samples,
// is a bracketed, whitespace-separated integer array (raw ADC counts), e.g. "[-329 -360 ...]".
// 7500 samples span 30 s, i.e. 250 Hz (the documented rate for this device; the export itself
// does not include a sample rate or a mV calibration, so amplitude stays in raw ADC units).
//
// An ECG reading is its own type (a short high-frequency waveform), not a Series, so like a
// Track it is exposed via a dedicated method rather than the registry's Series[] contract.
//
//   ECGReading = { id, timeMs, classification, heartRate, device, sampleRate, samples: Float64Array }

import { register } from '../core/registry.js';

const SAMPLE_RATE = 250; // Hz — documented device rate; not present in the export.

function field(header, row, name) {
  const i = header.indexOf(name);
  return i >= 0 ? row[i] : '';
}

export const ecgParser = {
  match(name) {
    return /^afib_ecg_reading_.*\.csv$/i.test(name);
  },

  parseReading(text, name) {
    const nl = text.indexOf('\n');
    const header = text.slice(0, nl).trim().split(',');
    const line = text.slice(nl + 1);

    const open = line.indexOf('[');
    const close = line.indexOf(']');
    const metaRow = line.slice(0, open).split(',');       // fields before the waveform
    const body = line.slice(open + 1, close);

    // parse whitespace-separated ints into a Float64Array, pre-sized generously then trimmed
    const parts = body.split(/\s+/);
    const samples = new Float64Array(parts.length);
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      const v = +parts[i];
      if (!Number.isNaN(v)) samples[w++] = v;
    }

    const msFromName = (name.match(/(\d+)\.csv$/) || [, ''])[1];
    return {
      id: field(header, metaRow, 'reading_id') || name,
      timeMs: msFromName ? +msFromName : Date.parse(field(header, metaRow, 'reading_time')),
      classification: field(header, metaRow, 'result_classification') || '?',
      heartRate: parseFloat(field(header, metaRow, 'heart_rate')) || null,
      device: field(header, metaRow, 'hardware_version') || '',
      sampleRate: SAMPLE_RATE,
      samples: samples.subarray(0, w),
    };
  },

  parse() { return []; }, // not a chartable Series; handled by the ECG view
};

register(ecgParser);
