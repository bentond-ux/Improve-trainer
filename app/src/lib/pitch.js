// Mic capture + pitchy pitch tracking. Calls onFrame({t, midi, voiced})
// per analysis frame using a clock relative to start().

import { PitchDetector } from "pitchy";
import { freqToMidi } from "./notes.js";

export class PitchTracker {
  constructor({ onFrame, clarityThreshold = 0.9, gateDb = -45 } = {}) {
    this.onFrame = onFrame;
    this.clarityThreshold = clarityThreshold;
    this.gateDb = gateDb;
    this.running = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    this.detector.minVolumeDecibels = -100;
    this.buf = new Float32Array(this.detector.inputLength);
    this.t0 = performance.now();
    this.running = true;
    this._loop();
  }

  _loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._loop);
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / this.buf.length) || 1e-9);
    const t = (performance.now() - this.t0) / 1000;
    if (db < this.gateDb) { this.onFrame({ t, midi: NaN, voiced: false }); return; }
    const [pitch, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate);
    const ok = clarity >= this.clarityThreshold && pitch > 60 && pitch < 1600;
    this.onFrame({ t, midi: ok ? freqToMidi(pitch) : NaN, voiced: ok, clarity, pitch });
  };

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    if (this.ctx) this.ctx.close();
  }
}
