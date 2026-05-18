import { NOTE_NAMES } from "../lib/notes.js";
import {
  pcHistogram, inferScale, topIntervals,
  phraseLengthDistribution, drift,
} from "../lib/analysis.js";

const IV_NAME = {
  0: "unison", 1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4",
  6: "tritone", 7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "octave",
};
const ivLabel = (i) =>
  (i < 0 ? "↓" : i > 0 ? "↑" : "") + (IV_NAME[Math.abs(i)] || `${i}st`);

export default function DroneRetro({ notes }) {
  if (!notes || notes.length < 6)
    return <p className="sub">Not enough played for a retrospective.</p>;

  const scale = inferScale(notes);
  const pc = pcHistogram(notes);
  const ivs = topIntervals(notes);
  const phr = phraseLengthDistribution(notes);
  const dr = drift(notes, scale.root, scale.mode);
  const maxPc = Math.max(...pc, 0.0001);

  return (
    <div>
      <h3 style={{ margin: "0 0 4px" }}>Drone session retrospective</h3>
      <p className="sub">
        {notes.length} notes · gravitated toward{" "}
        <b style={{ color: "var(--accent)" }}>{scale.name}</b>{" "}
        ({scale.coverage_pct}% of note-time in that scale)
      </p>

      <div className="split">
        <div>
          <b className="hist-h">Pitch-class emphasis</b>
          {pc.map((v, i) => (
            <div key={i} className="pcbar">
              <span>{NOTE_NAMES[i]}</span>
              <div className="pctrack">
                <div style={{ width: `${100 * v / maxPc}%` }} />
              </div>
              <span>{(100 * v).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <div>
          <b className="hist-h">Most common intervals</b>
          {ivs.map((x) => (
            <div key={x.interval} className="ckrow">
              <span>{ivLabel(x.interval)}</span><span>{x.pct}%</span>
            </div>
          ))}
          <b className="hist-h" style={{ marginTop: 12 }}>Phrase lengths</b>
          {phr.map((p) => (
            <div key={p.bucket} className="ckrow">
              <span>{p.bucket} notes</span><span>{p.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <b className="hist-h" style={{ marginTop: 14 }}>
        Drift across the session (start → end)
      </b>
      <div className="ckrow"><span>density (notes/sec)</span>
        <span>{dr.map((d) => d.density).join("  →  ")}</span></div>
      <div className="ckrow"><span>chromatic %</span>
        <span>{dr.map((d) => d.chromatic_pct).join("  →  ")}</span></div>
    </div>
  );
}
