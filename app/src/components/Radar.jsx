// Dependency-free SVG radar. Plots the player's session against the
// Garcia and Zappa fingerprints on normalised axes.

const AXES = [
  { key: "density_notes_per_sec", label: "density", max: 6 },
  { key: "chromaticism_pct_by_count", label: "chromatic", max: 50 },
  { key: "rest_percentage", label: "rest", max: 50 },
  { key: "interval_mean_abs", label: "interval", max: 8 },
  { key: "pct_leaps", label: "leaps", max: 70 },
  { key: "phrase_len_mean", label: "phrase", max: 16 },
  { key: "motivic_repetition_score", label: "repetition", max: 1 },
  { key: "rhythmic_cv", label: "rhythm CV", max: 1 },
];

const norm = (v, max) => Math.max(0, Math.min(1, (v ?? 0) / max));

function polygon(values, cx, cy, r) {
  return AXES.map((a, i) => {
    const ang = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
    const rad = r * norm(values[a.key], a.max);
    return `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
  }).join(" ");
}

function fpVals(fp) {
  const s = fp?.fingerprint?.scalars || {};
  const c = fp?.fingerprint?.contour || {};
  const o = {};
  for (const a of AXES) o[a.key] = (s[a.key]?.mean ?? c[a.key]?.mean ?? 0);
  return o;
}

export default function Radar({ user, garcia, zappa, size = 340 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 46;
  const g = garcia ? fpVals(garcia) : null;
  const z = zappa ? fpVals(zappa) : null;
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} role="img" aria-label="personality radar">
      {rings.map((rr, i) => (
        <polygon key={i}
          points={AXES.map((_, j) => {
            const ang = (Math.PI * 2 * j) / AXES.length - Math.PI / 2;
            return `${cx + r * rr * Math.cos(ang)},${cy + r * rr * Math.sin(ang)}`;
          }).join(" ")}
          fill="none" stroke="#2a313c" strokeWidth="1" />
      ))}
      {AXES.map((a, i) => {
        const ang = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
        const lx = cx + (r + 22) * Math.cos(ang);
        const ly = cy + (r + 22) * Math.sin(ang);
        return (
          <g key={a.key}>
            <line x1={cx} y1={cy} x2={cx + r * Math.cos(ang)}
              y2={cy + r * Math.sin(ang)} stroke="#2a313c" />
            <text x={lx} y={ly} fill="#8b949e" fontSize="11"
              textAnchor="middle" dominantBaseline="middle">{a.label}</text>
          </g>
        );
      })}
      {z && <polygon points={polygon(z, cx, cy, r)}
        fill="rgba(224,108,117,.12)" stroke="#e06c75" strokeWidth="1.5" />}
      {g && <polygon points={polygon(g, cx, cy, r)}
        fill="rgba(152,195,121,.12)" stroke="#98c379" strokeWidth="1.5" />}
      {user && <polygon points={polygon(user, cx, cy, r)}
        fill="rgba(78,201,176,.22)" stroke="#4ec9b0" strokeWidth="2.5" />}
    </svg>
  );
}
