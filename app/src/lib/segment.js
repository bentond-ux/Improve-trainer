// Port of analyzer/analyze.py segment_notes — same heuristics so the
// browser fingerprint is comparable to corpus fingerprints.
//
// Feed frames in order via push({ t, midi, voiced }). Completed note
// events are returned; call flush() at the end of a session.

import { midiToName } from "./notes.js";

export class Segmenter {
  constructor({ semitoneTol = 0.65, minNoteSec = 0.05, maxGapSec = 0.06 } = {}) {
    this.semitoneTol = semitoneTol;
    this.minNoteSec = minNoteSec;
    this.maxGapSec = maxGapSec;
    this.reset();
  }

  reset() {
    this.notes = [];
    this.segStart = null;
    this.segPitches = [];
    this.ref = null;
    this.lastVoicedT = null;
  }

  _median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  _close(endT) {
    if (this.segStart != null && this.segPitches.length) {
      const med = this._median(this.segPitches);
      const dur = endT - this.segStart;
      if (dur >= this.minNoteSec) {
        this.notes.push({
          onset: +this.segStart.toFixed(4),
          offset: +endT.toFixed(4),
          dur: +dur.toFixed(4),
          midi: Math.round(med),
          name: midiToName(med),
        });
      }
    }
    this.segStart = null;
    this.segPitches = [];
    this.ref = null;
  }

  push({ t, midi, voiced }) {
    const isV = voiced && Number.isFinite(midi);
    if (isV) {
      if (this.segStart == null) {
        this.segStart = t;
        this.segPitches = [midi];
        this.ref = midi;
      } else if (Math.abs(midi - this.ref) <= this.semitoneTol) {
        this.segPitches.push(midi);
        this.ref = 0.85 * this.ref + 0.15 * midi;
      } else {
        this._close(t);
        this.segStart = t;
        this.segPitches = [midi];
        this.ref = midi;
      }
      this.lastVoicedT = t;
    } else if (this.segStart != null && this.lastVoicedT != null) {
      if (t - this.lastVoicedT > this.maxGapSec) {
        this._close(this.lastVoicedT + 0.012);
      }
    }
  }

  flush() {
    if (this.segStart != null) {
      this._close((this.lastVoicedT ?? this.segStart) + 0.012);
    }
    return this.notes;
  }
}
