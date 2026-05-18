// JS port of the parameter subset used for the live readout and radar.
// Formulas mirror analyzer/analyze.py compute_metrics.

import { SCALES } from "./notes.js";

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function variance(a) { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); }
function median(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ngramRepetition(seq, n) {
  if (seq.length < n) return 0;
  const grams = [];
  for (let i = 0; i <= seq.length - n; i++) grams.push(seq.slice(i, i + n).join(","));
  return (grams.length - new Set(grams).size) / grams.length;
}

export function computeMetrics(notes, { root = 9, mode = "mixolydian", bpm = 100 } = {}) {
  const n = notes.length;
  if (n === 0) return { note_count: 0 };

  const onsets = notes.map((x) => x.onset);
  const offsets = notes.map((x) => x.offset);
  const durs = notes.map((x) => x.dur);
  const midis = notes.map((x) => x.midi);

  const span = offsets[n - 1] - onsets[0];
  const playTime = durs.reduce((s, x) => s + x, 0);
  const out = { note_count: n, active_span_sec: +span.toFixed(2) };

  out.density_notes_per_sec = span > 0 ? +(n / span).toFixed(3) : 0;
  out.density_notes_per_beat = span > 0 ? +((n / span) * (60 / bpm)).toFixed(3) : 0;
  out.pitch_range_semitones = Math.max(...midis) - Math.min(...midis);
  out.rest_percentage = span > 0 ? +(100 * Math.max(0, span - playTime) / span).toFixed(2) : 0;

  const intervals = [];
  for (let i = 1; i < n; i++) intervals.push(midis[i] - midis[i - 1]);
  if (intervals.length) {
    const abs = intervals.map(Math.abs);
    out.interval_mean_abs = +mean(abs).toFixed(3);
    out.pct_stepwise = +(100 * abs.filter((i) => i <= 2).length / abs.length).toFixed(2);
    out.pct_leaps = +(100 * abs.filter((i) => i >= 5).length / abs.length).toFixed(2);
  } else {
    out.interval_mean_abs = 0; out.pct_stepwise = 0; out.pct_leaps = 0;
  }

  const scale = new Set(SCALES[mode] || SCALES.major);
  const inScale = midis.filter((m) => scale.has((((m - root) % 12) + 12) % 12)).length;
  out.chromaticism_pct_by_count = +(100 * (1 - inScale / n)).toFixed(2);
  out.in_key_pct = +(100 * inScale / n).toFixed(2);

  const phraseGap = Math.max(0.35, 1.5 * median(durs));
  const phrases = [];
  let cur = 1;
  for (let i = 1; i < n; i++) {
    if (onsets[i] - offsets[i - 1] >= phraseGap) { phrases.push(cur); cur = 1; }
    else cur++;
  }
  phrases.push(cur);
  out.phrase_len_mean = +mean(phrases).toFixed(2);
  out.phrase_count = phrases.length;

  if (n > 1) {
    const iois = [];
    for (let i = 1; i < n; i++) iois.push(onsets[i] - onsets[i - 1]);
    const im = mean(iois);
    out.rhythmic_cv = im ? +(Math.sqrt(variance(iois)) / im).toFixed(4) : 0;
  } else out.rhythmic_cv = 0;

  out.motivic_repetition_score = +mean([
    ngramRepetition(intervals, 2),
    ngramRepetition(intervals, 3),
    ngramRepetition(intervals, 4),
  ]).toFixed(4);

  if (intervals.length) {
    const ti = intervals.length;
    out.contour = {
      ascending_pct: +(100 * intervals.filter((i) => i > 0).length / ti).toFixed(2),
      descending_pct: +(100 * intervals.filter((i) => i < 0).length / ti).toFixed(2),
      repeat_pct: +(100 * intervals.filter((i) => i === 0).length / ti).toFixed(2),
    };
  }
  return out;
}
