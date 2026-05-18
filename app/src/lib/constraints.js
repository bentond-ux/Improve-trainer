// Phase 4 — Constraint sets. Each rule is evaluated live against the
// metrics from computeMetrics(). Tagged by the personality it pulls
// the player toward.

export const CONSTRAINT_SETS = [
  {
    id: "g_space", personality: "garcia", name: "Space & Singing",
    desc: "Leave room. Play like you're singing, not running.",
    rules: [
      { key: "density_notes_per_sec", label: "≤ 2.0 notes/sec", op: "lte", a: 2.0 },
      { key: "rest_percentage", label: "≥ 20% rest", op: "gte", a: 20 },
      { key: "phrase_len_mean", label: "phrases ≤ 7 notes", op: "lte", a: 7 },
    ],
  },
  {
    id: "g_diatonic", personality: "garcia", name: "Stay Home",
    desc: "Diatonic and stepwise — no outside notes.",
    rules: [
      { key: "chromaticism_pct_by_count", label: "≤ 5% chromatic", op: "lte", a: 5 },
      { key: "pct_stepwise", label: "≥ 55% stepwise", op: "gte", a: 55 },
    ],
  },
  {
    id: "g_motif", personality: "garcia", name: "Motif Keeper",
    desc: "Develop a phrase by repeating and varying it.",
    rules: [
      { key: "motivic_repetition_score", label: "repetition ≥ 0.35", op: "gte", a: 0.35 },
      { key: "phrase_len_mean", label: "phrases ≤ 8 notes", op: "lte", a: 8 },
    ],
  },
  {
    id: "g_quarter", personality: "garcia", name: "Quarter-Note Talk",
    desc: "Even, conversational rhythm.",
    rules: [
      { key: "density_notes_per_sec", label: "1.0–2.5 notes/sec", op: "between", a: 1.0, b: 2.5 },
      { key: "rhythmic_cv", label: "rhythmic CV ≤ 0.45", op: "lte", a: 0.45 },
    ],
  },
  {
    id: "g_vocal", personality: "garcia", name: "Vocal Range",
    desc: "Stay in one octave, mostly steps.",
    rules: [
      { key: "pitch_range_semitones", label: "range ≤ 12 semitones", op: "lte", a: 12 },
      { key: "pct_leaps", label: "≤ 20% leaps", op: "lte", a: 20 },
    ],
  },
  {
    id: "g_breath", personality: "garcia", name: "Breathe",
    desc: "Short lines, big rests between them.",
    rules: [
      { key: "rest_percentage", label: "≥ 25% rest", op: "gte", a: 25 },
      { key: "phrase_len_mean", label: "phrases ≤ 6 notes", op: "lte", a: 6 },
    ],
  },

  {
    id: "z_chromatic", personality: "zappa", name: "Chromatic Attack",
    desc: "Live outside the key. Leap, don't step.",
    rules: [
      { key: "chromaticism_pct_by_count", label: "≥ 20% chromatic", op: "gte", a: 20 },
      { key: "pct_leaps", label: "≥ 30% leaps", op: "gte", a: 30 },
    ],
  },
  {
    id: "z_density", personality: "zappa", name: "Density Machine",
    desc: "Relentless. Almost no rest.",
    rules: [
      { key: "density_notes_per_sec", label: "≥ 4 notes/sec", op: "gte", a: 4 },
      { key: "rest_percentage", label: "≤ 10% rest", op: "lte", a: 10 },
    ],
  },
  {
    id: "z_norepeat", personality: "zappa", name: "No Repeats",
    desc: "Never play the same shape twice. Long lines.",
    rules: [
      { key: "motivic_repetition_score", label: "repetition ≤ 0.15", op: "lte", a: 0.15 },
      { key: "phrase_len_mean", label: "phrases ≥ 10 notes", op: "gte", a: 10 },
    ],
  },
  {
    id: "z_wide", personality: "zappa", name: "Wide Intervals",
    desc: "Big jumps. Avoid scalar runs.",
    rules: [
      { key: "interval_mean_abs", label: "mean |interval| ≥ 4.5", op: "gte", a: 4.5 },
      { key: "pct_leaps", label: "≥ 35% leaps", op: "gte", a: 35 },
    ],
  },
  {
    id: "z_displace", personality: "zappa", name: "Rhythmic Displacement",
    desc: "Uneven, unpredictable rhythm at speed.",
    rules: [
      { key: "rhythmic_cv", label: "rhythmic CV ≥ 0.5", op: "gte", a: 0.5 },
      { key: "density_notes_per_sec", label: "≥ 3 notes/sec", op: "gte", a: 3 },
    ],
  },
  {
    id: "z_longform", personality: "zappa", name: "Long-Form Lines",
    desc: "One unbroken stream of ideas.",
    rules: [
      { key: "phrase_len_mean", label: "phrases ≥ 12 notes", op: "gte", a: 12 },
      { key: "rest_percentage", label: "≤ 12% rest", op: "lte", a: 12 },
    ],
  },
];

export function evaluateRule(rule, metrics) {
  const v = metrics?.[rule.key];
  if (v == null) return { pass: false, value: null };
  let pass;
  if (rule.op === "gte") pass = v >= rule.a;
  else if (rule.op === "lte") pass = v <= rule.a;
  else pass = v >= rule.a && v <= rule.b;
  return { pass, value: v };
}

export function evaluateSet(set, metrics) {
  const rules = set.rules.map((r) => ({ ...r, ...evaluateRule(r, metrics) }));
  return { rules, passed: rules.filter((r) => r.pass).length, total: rules.length };
}
