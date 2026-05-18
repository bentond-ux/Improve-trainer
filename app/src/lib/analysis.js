// Phase 5 — retrospective analysis for Drone Immersion. Computed once
// at end of session from the full note list (no live scoring).

import { NOTE_NAMES, SCALES } from "./notes.js";

export function pcHistogram(notes) {
  const h = new Array(12).fill(0);
  let tot = 0;
  for (const n of notes) { h[((n.midi % 12) + 12) % 12] += n.dur; tot += n.dur; }
  return h.map((x) => (tot ? +(x / tot).toFixed(4) : 0));
}

// Best-fitting scale: maximise note-time falling on scale tones.
export function inferScale(notes) {
  const h = pcHistogram(notes);
  let best = { root: 0, mode: "major", coverage: -1 };
  for (let root = 0; root < 12; root++) {
    for (const mode of Object.keys(SCALES)) {
      const set = new Set(SCALES[mode]);
      let cov = 0;
      for (let pc = 0; pc < 12; pc++)
        if (set.has(((pc - root) % 12 + 12) % 12)) cov += h[pc];
      if (cov > best.coverage) best = { root, mode, coverage: cov };
    }
  }
  return {
    name: `${NOTE_NAMES[best.root]} ${best.mode}`,
    coverage_pct: +(100 * best.coverage).toFixed(1),
    root: best.root, mode: best.mode,
  };
}

export function topIntervals(notes, k = 6) {
  const c = new Map();
  for (let i = 1; i < notes.length; i++) {
    const d = Math.max(-12, Math.min(12, notes[i].midi - notes[i - 1].midi));
    c.set(d, (c.get(d) || 0) + 1);
  }
  const tot = [...c.values()].reduce((s, x) => s + x, 0) || 1;
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([iv, n]) => ({ interval: iv, pct: +(100 * n / tot).toFixed(1) }));
}

export function phraseLengthDistribution(notes) {
  if (notes.length === 0) return [];
  const durs = notes.map((n) => n.dur).sort((a, b) => a - b);
  const med = durs[durs.length >> 1];
  const gap = Math.max(0.35, 1.5 * med);
  const phrases = [];
  let cur = 1;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].onset - notes[i - 1].offset >= gap) { phrases.push(cur); cur = 1; }
    else cur++;
  }
  phrases.push(cur);
  const buckets = { "1-3": 0, "4-6": 0, "7-10": 0, "11-15": 0, "16+": 0 };
  for (const p of phrases) {
    if (p <= 3) buckets["1-3"]++;
    else if (p <= 6) buckets["4-6"]++;
    else if (p <= 10) buckets["7-10"]++;
    else if (p <= 15) buckets["11-15"]++;
    else buckets["16+"]++;
  }
  const tot = phrases.length || 1;
  return Object.entries(buckets).map(([k, v]) => ({
    bucket: k, pct: +(100 * v / tot).toFixed(0), count: v,
  }));
}

// Density / chromaticism drift across the session, split into thirds.
export function drift(notes, root, scaleMode) {
  if (notes.length < 6) return [];
  const t0 = notes[0].onset, t1 = notes[notes.length - 1].offset;
  const span = t1 - t0 || 1;
  const set = new Set(SCALES[scaleMode] || SCALES.major);
  const seg = [[], [], []];
  for (const n of notes) {
    const idx = Math.min(2, Math.floor(3 * (n.onset - t0) / span));
    seg[idx].push(n);
  }
  return seg.map((ns, i) => {
    if (ns.length < 2) return { third: i + 1, density: 0, chromatic_pct: 0 };
    const dur = ns[ns.length - 1].offset - ns[0].onset || 1;
    const outside = ns.filter(
      (n) => !set.has((((n.midi - root) % 12) + 12) % 12)).length;
    return {
      third: i + 1,
      density: +(ns.length / dur).toFixed(2),
      chromatic_pct: +(100 * outside / ns.length).toFixed(1),
    };
  });
}
