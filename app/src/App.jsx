import { useEffect, useRef, useState } from "react";
import { EXERCISES, Backing } from "./lib/backing.js";
import { PitchTracker } from "./lib/pitch.js";
import { Segmenter } from "./lib/segment.js";
import { computeMetrics } from "./lib/metrics.js";
import { parseKey, midiToName } from "./lib/notes.js";
import { loadSessions, saveSession, clearSessions } from "./lib/store.js";
import { CONSTRAINT_SETS } from "./lib/constraints.js";
import Radar from "./components/Radar.jsx";
import ConstraintChecklist from "./components/ConstraintChecklist.jsx";
import DroneRetro from "./components/DroneRetro.jsx";

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
const DRONE_OPTS = [
  { s: 300, label: "5 min" },
  { s: 600, label: "10 min" },
  { s: 1200, label: "20 min" },
];

export default function App() {
  const [mode, setMode] = useState("practice");
  const [fp, setFp] = useState({ garcia: null, zappa: null });
  const [exId, setExId] = useState(EXERCISES[0].id);
  const [constraintId, setConstraintId] = useState("");
  const [droneSecs, setDroneSecs] = useState(600);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [curNote, setCurNote] = useState(null);
  const [live, setLive] = useState(null);
  const [result, setResult] = useState(null);
  const [droneNotes, setDroneNotes] = useState(null);
  const [sessions, setSessions] = useState(loadSessions());
  const [err, setErr] = useState("");

  const seg = useRef(null);
  const tracker = useRef(null);
  const backing = useRef(new Backing());
  const tick = useRef(null);

  const ex = EXERCISES.find((e) => e.id === exId);
  const constraint = CONSTRAINT_SETS.find((c) => c.id === constraintId) || null;
  const isDrone = mode === "drone";
  const duration = isDrone ? droneSecs : ex.seconds;

  useEffect(() => {
    Promise.all([
      fetch("fingerprints/garcia.json").then((r) => r.json()).catch(() => null),
      fetch("fingerprints/zappa.json").then((r) => r.json()).catch(() => null),
    ]).then(([garcia, zappa]) => setFp({ garcia, zappa }));
  }, []);

  function recompute() {
    if (!seg.current || seg.current.notes.length < 2) return;
    const k = parseKey(ex.key);
    setLive(computeMetrics([...seg.current.notes],
      { root: k.root, mode: k.mode, bpm: ex.bpm }));
  }

  async function start() {
    setErr(""); setResult(null); setLive(null);
    setDroneNotes(null); setElapsed(0);
    seg.current = new Segmenter();
    tracker.current = new PitchTracker({
      onFrame: ({ t, midi, voiced }) => {
        seg.current.push({ t, midi, voiced });
        if (!isDrone)
          setCurNote(voiced && Number.isFinite(midi) ? midiToName(midi) : null);
      },
    });
    try {
      await tracker.current.start();
    } catch (e) {
      setErr("Mic failed: " + e.message + " (needs https:// or localhost)");
      return;
    }
    await backing.current.start(isDrone ? "drone" : exId);
    setRunning(true);
    const t0 = performance.now();
    tick.current = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      setElapsed(s);
      if (!isDrone) recompute();
      if (s >= duration) stop();
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

    if (isDrone) {
      setDroneNotes(notes);
      if (m.note_count > 1)
        setSessions(saveSession({
          ts: new Date().toISOString(), mode: "drone",
          exercise: "Drone immersion", key: ex.key, metrics: m,
        }));
      return;
    }
    setResult(m);
    if (m.note_count > 1)
      setSessions(saveSession({
        ts: new Date().toISOString(), mode: "practice",
        exercise: ex.name, exId, key: ex.key,
        constraint: constraint?.name || null, metrics: m,
      }));
  }

  const shown = result || live;

  return (
    <div className="wrap">
      <h1>Improve Trainer</h1>
      <div className="tabs">
        {["practice", "drone"].map((t) => (
          <button key={t} disabled={running}
            className={"tab" + (mode === t ? " active" : "")}
            onClick={() => { setMode(t); setResult(null); setDroneNotes(null); }}>
            {t === "practice" ? "Practice" : "Drone immersion"}
          </button>
        ))}
      </div>

      <div className="card">
        {!isDrone ? (
          <>
            <div className="exgrid">
              {EXERCISES.map((e) => (
                <button key={e.id} disabled={running}
                  className={"ex" + (e.id === exId ? " active" : "")}
                  onClick={() => setExId(e.id)}>
                  <b>{e.name}</b>
                  <span>{e.seconds}s · {e.key} · {e.bpm}bpm<br />{e.blurb}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label style={{ color: "var(--dim)", fontSize: 13 }}>Constraint set:</label>
              <select value={constraintId} disabled={running}
                onChange={(e) => setConstraintId(e.target.value)}
                className="sel">
                <option value="">— none (free practice) —</option>
                <optgroup label="→ Garcia">
                  {CONSTRAINT_SETS.filter((c) => c.personality === "garcia")
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
                <optgroup label="→ Zappa">
                  {CONSTRAINT_SETS.filter((c) => c.personality === "zappa")
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              </select>
            </div>
          </>
        ) : (
          <>
            <p className="sub" style={{ marginTop: 0 }}>
              Play freely over a drone. No scoring while you play — a
              retrospective is shown at the end.
            </p>
            <div className="row">
              <label style={{ color: "var(--dim)", fontSize: 13 }}>Length:</label>
              {DRONE_OPTS.map((o) => (
                <button key={o.s} disabled={running}
                  className={"ex" + (droneSecs === o.s ? " active" : "")}
                  style={{ padding: "8px 14px" }}
                  onClick={() => setDroneSecs(o.s)}>{o.label}</button>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          {!running
            ? <button className="primary" onClick={start}>
                ▶ Start ({Math.round(duration / 60)} min)</button>
            : <button onClick={stop}>■ Stop</button>}
          {!isDrone &&
            <div className={"note" + (curNote ? "" : " idle")}>{curNote || "—"}</div>}
          <div className="timer">
            {Math.floor(elapsed)}s
            <span style={{ color: "var(--dim)" }}> / {duration}s</span>
          </div>
        </div>
        <div className="bar">
          <div style={{ width: `${Math.min(100, 100 * elapsed / duration)}%` }} />
        </div>
        {err && <div className="err">{err}</div>}
        {(fp.garcia?.synthetic || fp.zappa?.synthetic) && !isDrone && (
          <div className="warn">
            ⚠ Fingerprints are SYNTHETIC placeholders — replace with Phase 2
            corpus output before trusting the radar.
          </div>
        )}
      </div>

      {!isDrone && constraint && (
        <ConstraintChecklist set={constraint} metrics={shown} />
      )}

      {isDrone ? (
        <div className="card">
          {droneNotes
            ? <DroneRetro notes={droneNotes} />
            : <p className="sub">
                {running ? "Recording… play freely, no scoring shown."
                         : "Pick a length and start. Retrospective appears when you stop."}
              </p>}
        </div>
      ) : (
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
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>History ({sessions.length})</b>
          {sessions.length > 0 &&
            <button onClick={() => { clearSessions(); setSessions([]); }}>Clear</button>}
        </div>
        <div className="hist" style={{ marginTop: 8 }}>
          {sessions.slice(0, 12).map((s, i) => (
            <div key={i}>
              <span>
                {new Date(s.ts).toLocaleString()} · {s.exercise}
                {s.constraint ? ` · {${s.constraint}}` : ""}
              </span>
              <span>
                {s.metrics.note_count}n · d{s.metrics.density_notes_per_sec} ·
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
