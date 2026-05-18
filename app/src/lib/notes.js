export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

export const SCALES = {
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  dorian:     [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
  lydian:     [0,2,4,6,7,9,11],
  phrygian:   [0,1,3,5,7,8,10],
};

export function freqToMidi(f) {
  return 69 + 12 * Math.log2(f / 440);
}

export function midiToName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function parseKey(str) {
  const [rootRaw, modeRaw] = str.trim().split(/\s+/);
  const root = NOTE_NAMES.indexOf(rootRaw);
  const mode = (modeRaw || "major").toLowerCase();
  return { root: root < 0 ? 9 : root, mode: SCALES[mode] ? mode : "major" };
}
