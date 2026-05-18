import { useEffect, useRef, useState } from "react";
import { EXERCISES, Backing } from "./lib/backing.js";
import { PitchTracker } from "./lib/pitch.js";
import { Segmenter } from "./lib/segment.js";
import { computeMetrics } from "./lib/metrics.js";
import { parseKey, midiToName } from "./lib/notes.js";
import { loadSessions, saveSession, clearSessions } from "./lib/store.js";
import Radar from "./components/Radar.jsx";

const READOUT = [
  ["density_notes_per_sec", "density /sec"],
  ["chromaticism_pct_by_count", "chromaticism %"],
  ["in_key_pct", "in-key %"],
  ["rest_percentage", "rest %"],
  ["interval_mean_abs", "mean |interval|"],
  ["pct_stepwise", "stepwise %"],
  ["pct_leaps", "leaps %"],
  ["phrase_len_mean", "phrase length"],
  ["rhythmic_cv", "rhythmic CV"],
  ["motivic_repetition_score", "motivic repetition"],
  ["pitch_range_semitones", "range (semitones)"],
];

export default function App() {
  const [fp, setFp] = useState({ garcia: null, zappa: null });
  const [exId, setExId] = useState(EXERCISES[0].id);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [curNote, setCurNote] = useState(null);
  const [live, setLive] = useState(null);
  const [result, setResult] = useState(null);
  const [sessions, setSessions] = useState(loadSessions());
  const [err, setErr] = useState("");

  const seg = useRef(null);
  const tracker = useRef(null);
  const backing = useRef(new Backing());
  const tick = useRef(null);

  const ex = EXERCISES.find((e) => e.id === exId);

  useEffect(() => {
    Promise.all([
      fetch("fingerprints/garcia.json").then((r) => r.json()).catch(() => null),
      fetch("fingerprints/zappa.json").then((r) => r.json()).catch(() => null),
    ]).then(([garcia, zappa]) => setFp({ garcia, zappa }));
  }, []);

  function recompute() {
    if (!seg.current) return;
    const notes = [...seg.current.notes];
    if (notes.length < 2) return;
    const k = parseKey(ex.key);
    setLive(computeMetrics(notes, { root: k.root, mode: k.mode, bpm: ex.bpm }));
  }

  async function start() {
    setErr(""); setResult(null); setLive(null); setElapsed(0);
    seg.current = new Segmenter();
    tracker.current = new PitchTracker({
      onFrame: ({ t, midi, voiced }) => {
        seg.current.push({ t, midi, voiced });
        setCurNote(voiced && Number.isFinite(midi) ? midiToName(midi) : null);
      },
    });
    try {
      await tracker.current.start();
    } catch (e) {
      setErr("Mic failed: " + e.message + " (needs https:// or localhost)");
      return;
    }
    await backing.current.start(exId);
    setRunning(true);
    const t0 = performance.now();
    tick.current = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      setElapsed(s);
      recompute();
      if (s >= ex.seconds) stop();
    }, 1000);
  }

  function stop() {
    if (tick.current) clearInterval(tick.current);
    tracker.current?.stop();
    backing.current.stop();
    setRunning(false);
    setCurNote(null);
    const notes = seg.current ? seg.current.flush() : [];
    const k = parseKey(ex.key);
    const m = computeMetrics(notes, { root: k.root, mode: k.mode, bpm: ex.bpm });
    setResult(m);
    if (m.note_count > 1) {
      const rec = {
        ts: new Date().toISOString(),
        exercise: ex.name, exId, key: ex.key, metrics: m,
      };
      setSessions(saveSession(rec));
    }
  }

  const shown = result || live;

  return (
    <div className="wrap">
      <h1>Improve Trainer — Phase 3 MVP</h1>
      <p className="sub">
        Pick an exercise, play for the timer, see your parameter readout and
        personality fingerprint vs Garcia &amp; Zappa.
      </p>

      <div className="card">
        <div className="exgrid">
          {EXERCISES.map((e) => (
            <button key={e.id}
              className={"ex" + (e.id === exId ? " active" : "")}
              disabled={running}
              onClick={() => setExId(e.id)}>
              <b>{e.name}</b>
              <span>{e.seconds}s · {e.key} · {e.bpm}bpm<br />{e.blurb}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {!running
            ? <button className="primary" onClick={start}>▶ Start ({ex.seconds}s)</button>
            : <button onClick={stop}>■ Stop</button>}
          <div className={"note" + (curNote ? "" : " idle")}>{curNote || "—"}</div>
          <div className="timer">
            {Math.floor(elapsed)}s<span style={{ color: "var(--dim)" }}> / {ex.seconds}s</span>
          </div>
        </div>
        <div className="bar"><div style={{ width: `${Math.min(100, 100 * elapsed / ex.seconds)}%` }} /></div>
        {err && <div className="err">{err}</div>}
        {(fp.garcia?.synthetic || fp.zappa?.synthetic) && (
          <div className="warn">
            ⚠ Fingerprints are SYNTHETIC placeholders. Replace with Phase 2
            corpus output (analyzer/aggregate.py) before trusting the radar.
          </div>
        )}
      </div>

      <div className="split">
        <div className="card">
          <Radar
            user={shown && shown.note_count > 1 ? shown : null}
            garcia={fp.garcia} zappa={fp.zappa} />
          <div className="legend">
            <span><i style={{ background: "var(--accent)" }} />you</span>
            <span><i style={{ background: "var(--garcia)" }} />Garcia</span>
            <span><i style={{ background: "var(--zappa)" }} />Zappa</span>
          </div>
        </div>
        <div className="card">
          {shown && shown.note_count > 0 ? (
            <table><tbody>
              <tr><td>notes</td><td>{shown.note_count}</td></tr>
              {READOUT.map(([k, label]) => (
                <tr key={k}><td>{label}</td><td>{shown[k] ?? "—"}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="sub">No data yet — play the exercise.</p>}
          {result && <p className="sub" style={{ marginTop: 10 }}>Session saved.</p>}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>History ({sessions.length})</b>
          {sessions.length > 0 &&
            <button onClick={() => { clearSessions(); setSessions([]); }}>Clear</button>}
        </div>
        <div className="hist" style={{ marginTop: 8 }}>
          {sessions.slice(0, 12).map((s, i) => (
            <div key={i}>
              <span>{new Date(s.ts).toLocaleString()} · {s.exercise}</span>
              <span>
                {s.metrics.note_count}n ·
                d{s.metrics.density_notes_per_sec} ·
                chr{s.metrics.chromaticism_pct_by_count}% ·
                rep{s.metrics.motivic_repetition_score}
              </span>
            </div>
          ))}
          {sessions.length === 0 && <span>No sessions yet.</span>}
        </div>
      </div>
    </div>
  );
}
