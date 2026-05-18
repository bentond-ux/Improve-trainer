// Tone.js backing tracks for the three Phase 3 exercises.

import * as Tone from "tone";

export const EXERCISES = [
  {
    id: "drone",
    name: "A Mixolydian drone",
    seconds: 60,
    bpm: 100,
    key: "A mixolydian",
    blurb: "Single key, no changes. Tests in-key % and basic phrasing.",
  },
  {
    id: "vamp",
    name: "I–IV vamp in A",
    seconds: 60,
    bpm: 100,
    key: "A mixolydian",
    blurb: "A → D, two bars each. Tests target tones over changes.",
  },
  {
    id: "garcia",
    name: "Garcia-style changes",
    seconds: 90,
    bpm: 104,
    key: "A mixolydian",
    blurb: "A → G → D loop (I–bVII–IV). Tests everything at once.",
  },
];

export class Backing {
  async start(exId) {
    await Tone.start();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    this._nodes = [];

    if (exId === "drone") {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 1.5, release: 2, sustain: 1 },
        volume: -16,
      }).toDestination();
      synth.triggerAttack(["A2", "E3", "A3"]);
      this._nodes.push(synth);
    } else {
      const bpm = exId === "garcia" ? 104 : 100;
      Tone.Transport.bpm.value = bpm;
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.05, release: 0.4 },
        volume: -15,
      }).toDestination();
      const bass = new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.02, release: 0.3 },
        volume: -14,
      }).toDestination();
      this._nodes.push(pad, bass);

      const prog =
        exId === "vamp"
          ? [{ ch: ["A3", "C#4", "E4"], root: "A1", bars: 2 },
             { ch: ["D3", "F#3", "A3"], root: "D2", bars: 2 }]
          : [{ ch: ["A3", "C#4", "E4"], root: "A1", bars: 2 },
             { ch: ["G3", "B3", "D4"], root: "G1", bars: 1 },
             { ch: ["D3", "F#3", "A3"], root: "D2", bars: 1 }];

      let bar = 0;
      const totalBars = prog.reduce((s, p) => s + p.bars, 0);
      const loop = new Tone.Loop((time) => {
        let acc = 0;
        const cur = bar % totalBars;
        let chord = prog[0];
        for (const p of prog) { if (cur < acc + p.bars) { chord = p; break; } acc += p.bars; }
        pad.triggerAttackRelease(chord.ch, "2n", time);
        pad.triggerAttackRelease(chord.ch, "2n", time + Tone.Time("2n").toSeconds());
        bass.triggerAttackRelease(chord.root, "4n", time);
        bass.triggerAttackRelease(chord.root, "4n", time + Tone.Time("2n").toSeconds());
        bar++;
      }, "1m");
      loop.start(0);
      this._nodes.push(loop);
      Tone.Transport.start();
    }
  }

  stop() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    (this._nodes || []).forEach((n) => {
      try { n.releaseAll ? n.releaseAll() : n.dispose && n.dispose(); } catch {}
      try { n.dispose && n.dispose(); } catch {}
    });
    this._nodes = [];
  }
}
