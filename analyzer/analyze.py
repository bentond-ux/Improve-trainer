# Phase 1 — Personality Analyzer
#
# Takes an audio file, tracks pitch, segments it into discrete note events,
# and computes the parameter "fingerprint" used to characterise a player's
# improvisational personality. Outputs JSON.
#
# Usage:
#   python analyze.py solo.wav --label garcia --out garcia_solo1.json
#   python analyze.py solo.wav --bpm 120 --key "A mixolydian"
#
# Deps: see requirements.txt  (numpy, librosa, soundfile, scipy)

import argparse
import json
import math
import os
import sys
from collections import Counter

import numpy as np

ANALYZER_VERSION = "0.1.0"

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Scale degrees (semitones from tonic) per mode. Used for chromaticism.
SCALES = {
    "major":      [0, 2, 4, 5, 7, 9, 11],
    "minor":      [0, 2, 3, 5, 7, 8, 10],   # natural minor
    "dorian":     [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "lydian":     [0, 2, 4, 6, 7, 9, 11],
    "phrygian":   [0, 1, 3, 5, 7, 8, 10],
}

# Krumhansl-Schmuckler key profiles (for automatic key estimation).
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                     2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                     2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Rhythmic-value templates, expressed as fraction of one beat.
SUBDIVISIONS = {
    "whole": 4.0, "half": 2.0, "quarter": 1.0,
    "eighth": 0.5, "sixteenth": 0.25,
    "eighth-triplet": 1.0 / 3.0, "quarter-triplet": 2.0 / 3.0,
    "thirty-second": 0.125,
}


def midi_to_name(midi):
    midi = int(round(midi))
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


# --------------------------------------------------------------------------- #
# Pitch tracking
# --------------------------------------------------------------------------- #

def pitch_track(path, method="pyin", sr=22050, fmin=70.0, fmax=1600.0):
    """Return (times, f0_midi, voiced) at a fixed hop.

    f0_midi is float MIDI pitch, NaN where unvoiced.
    """
    import librosa

    y, sr = librosa.load(path, sr=sr, mono=True)
    duration = len(y) / sr
    hop = 512

    if method == "crepe":
        try:
            import crepe  # optional, heavy (tensorflow)
        except ImportError:
            sys.exit("crepe not installed; use --method pyin or `pip install crepe`")
        import scipy.signal
        y16 = scipy.signal.resample(y, int(len(y) * 16000 / sr))
        t, freq, conf, _ = crepe.predict(y16, 16000, viterbi=True, step_size=10)
        voiced = conf > 0.5
        f0 = np.where(voiced, freq, np.nan)
        times = t
    else:  # pyin
        f0_hz, voiced, vprob = librosa.pyin(
            y, sr=sr, fmin=fmin, fmax=fmax, hop_length=hop
        )
        times = librosa.times_like(f0_hz, sr=sr, hop_length=hop)
        f0 = f0_hz

    with np.errstate(divide="ignore", invalid="ignore"):
        f0_midi = 69.0 + 12.0 * np.log2(f0 / 440.0)
    voiced = np.nan_to_num(voiced.astype(float), nan=0.0) > 0.5 \
        if voiced is not None else ~np.isnan(f0_midi)

    return times, f0_midi, voiced, duration, sr


# --------------------------------------------------------------------------- #
# Note segmentation
# --------------------------------------------------------------------------- #

def segment_notes(times, f0_midi, voiced,
                   semitone_tol=0.65, min_note_sec=0.05,
                   max_gap_sec=0.06):
    """Group frames into discrete note events.

    A note continues while voiced and within `semitone_tol` of the
    segment's reference pitch. Gaps shorter than `max_gap_sec` are
    bridged (legato / vibrato dropouts). Segments shorter than
    `min_note_sec` are discarded as detection blips.

    Returns list of dicts: {onset, offset, dur, midi (median), name}.
    """
    notes = []
    seg_start = None
    seg_pitches = []
    last_voiced_t = None
    ref = None

    def close(end_t):
        nonlocal seg_start, seg_pitches, ref
        if seg_start is not None and seg_pitches:
            med = float(np.median(seg_pitches))
            dur = end_t - seg_start
            if dur >= min_note_sec:
                notes.append({
                    "onset": round(seg_start, 4),
                    "offset": round(end_t, 4),
                    "dur": round(dur, 4),
                    "midi": int(round(med)),
                    "name": midi_to_name(med),
                })
        seg_start, seg_pitches, ref = None, [], None

    dt = float(np.median(np.diff(times))) if len(times) > 1 else 0.0116

    for i, t in enumerate(times):
        m = f0_midi[i]
        is_v = bool(voiced[i]) and not (isinstance(m, float) and math.isnan(m))

        if is_v:
            if seg_start is None:
                seg_start, seg_pitches, ref = t, [m], m
            elif abs(m - ref) <= semitone_tol:
                seg_pitches.append(m)
                ref = 0.85 * ref + 0.15 * m  # slow-track vibrato/bend center
            else:
                close(t)
                seg_start, seg_pitches, ref = t, [m], m
            last_voiced_t = t
        else:
            if seg_start is not None and last_voiced_t is not None:
                if (t - last_voiced_t) > max_gap_sec:
                    close(last_voiced_t + dt)

    if seg_start is not None:
        close((last_voiced_t if last_voiced_t else times[-1]) + dt)

    return notes


# --------------------------------------------------------------------------- #
# Key estimation
# --------------------------------------------------------------------------- #

def estimate_key(notes):
    """Krumhansl-Schmuckler key finding, weighted by note duration."""
    if not notes:
        return None, None, 0.0
    weights = np.zeros(12)
    for n in notes:
        weights[n["midi"] % 12] += n["dur"]
    if weights.sum() == 0:
        return None, None, 0.0
    weights /= weights.sum()

    best = (-2.0, 0, "major")
    for tonic in range(12):
        for mode, profile in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            rotated = np.roll(profile, tonic)
            r = float(np.corrcoef(weights, rotated)[0, 1])
            if r > best[0]:
                best = (r, tonic, mode)
    corr, tonic, mode = best
    return NOTE_NAMES[tonic], mode, round(corr, 3)


def parse_key(s):
    parts = s.strip().split()
    root = parts[0].capitalize().replace("Db", "C#").replace("Eb", "D#") \
        .replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#")
    if root not in NOTE_NAMES:
        sys.exit(f"Unrecognised key root: {parts[0]}")
    mode = parts[1].lower() if len(parts) > 1 else "major"
    if mode not in SCALES:
        sys.exit(f"Unsupported mode '{mode}'. Use one of {list(SCALES)}")
    return NOTE_NAMES.index(root), mode


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def histogram_proportions(values, lo, hi):
    counts = Counter(max(lo, min(hi, v)) for v in values)
    total = sum(counts.values()) or 1
    return {str(k): round(counts.get(k, 0) / total, 4)
            for k in range(lo, hi + 1)}


def ngram_repetition(seq, n):
    if len(seq) < n:
        return 0.0
    grams = [tuple(seq[i:i + n]) for i in range(len(seq) - n + 1)]
    total = len(grams)
    unique = len(set(grams))
    return round((total - unique) / total, 4)


def compute_metrics(notes, duration, bpm, key_root, key_mode, key_corr):
    n = len(notes)
    out = {"note_count": n, "file_duration_sec": round(duration, 3)}
    if n == 0:
        out["error"] = "no notes detected"
        return out

    onsets = np.array([x["onset"] for x in notes])
    offsets = np.array([x["offset"] for x in notes])
    durs = np.array([x["dur"] for x in notes])
    midis = np.array([x["midi"] for x in notes])

    span = float(offsets[-1] - onsets[0])
    out["active_span_sec"] = round(span, 3)

    # Density
    play_time = float(durs.sum())
    out["density_notes_per_sec"] = round(n / span, 3) if span > 0 else 0.0
    if bpm:
        out["density_notes_per_beat"] = round(
            (n / span) * (60.0 / bpm), 3) if span > 0 else 0.0

    # Pitch range
    out["pitch_range_semitones"] = int(midis.max() - midis.min())
    out["pitch_low"] = midi_to_name(int(midis.min()))
    out["pitch_high"] = midi_to_name(int(midis.max()))

    # Rest percentage (silence within the active span)
    rest = max(0.0, span - play_time)
    out["rest_percentage"] = round(100.0 * rest / span, 2) if span > 0 else 0.0

    # Melodic intervals (signed semitones between consecutive notes)
    intervals = np.diff(midis).astype(int).tolist()
    if intervals:
        abs_iv = [abs(i) for i in intervals]
        out["interval_mean_abs"] = round(float(np.mean(abs_iv)), 3)
        out["interval_distribution"] = histogram_proportions(intervals, -12, 12)
        out["pct_stepwise"] = round(
            100.0 * sum(1 for i in abs_iv if i <= 2) / len(abs_iv), 2)
        out["pct_leaps"] = round(
            100.0 * sum(1 for i in abs_iv if i >= 5) / len(abs_iv), 2)
    else:
        out["interval_mean_abs"] = 0.0
        out["interval_distribution"] = {}
        out["pct_stepwise"] = out["pct_leaps"] = 0.0

    # Chromaticism (relative to estimated or supplied key)
    scale = set(SCALES[key_mode])
    in_scale_count = sum(1 for m in midis
                         if (int(m) - key_root) % 12 in scale)
    in_scale_dur = sum(d for m, d in zip(midis, durs)
                       if (int(m) - key_root) % 12 in scale)
    out["estimated_key"] = f"{NOTE_NAMES[key_root]} {key_mode}"
    out["key_confidence"] = key_corr
    out["chromaticism_pct_by_count"] = round(
        100.0 * (1 - in_scale_count / n), 2)
    out["chromaticism_pct_by_duration"] = round(
        100.0 * (1 - in_scale_dur / play_time), 2) if play_time else 0.0
    out["in_key_pct"] = round(100.0 * in_scale_count / n, 2)

    # Phrases (split at rests >= phrase_gap)
    phrase_gap = max(0.35, 1.5 * float(np.median(durs)))
    phrases, cur = [], 1
    for i in range(1, n):
        gap = onsets[i] - offsets[i - 1]
        if gap >= phrase_gap:
            phrases.append(cur)
            cur = 1
        else:
            cur += 1
    phrases.append(cur)
    out["phrase_count"] = len(phrases)
    out["phrase_len_mean"] = round(float(np.mean(phrases)), 2)
    out["phrase_len_median"] = float(np.median(phrases))
    out["phrase_len_max"] = int(max(phrases))
    out["phrase_gap_sec"] = round(phrase_gap, 3)

    # Rhythm: inter-onset intervals
    if n > 1:
        iois = np.diff(onsets)
        out["ioi_mean_sec"] = round(float(np.mean(iois)), 4)
        out["rhythmic_variance_sec2"] = round(float(np.var(iois)), 5)
        out["rhythmic_cv"] = round(
            float(np.std(iois) / np.mean(iois)), 4) if np.mean(iois) else 0.0
    else:
        out["ioi_mean_sec"] = out["rhythmic_variance_sec2"] = 0.0
        out["rhythmic_cv"] = 0.0

    # Subdivision distribution (needs a beat length)
    if bpm:
        beat = 60.0 / bpm
        labels = []
        for d in durs:
            ratio = d / beat
            best_lab, best_err = "other", 0.5
            for lab, frac in SUBDIVISIONS.items():
                err = abs(math.log2(ratio / frac)) if ratio > 0 else 9
                if err < best_err:
                    best_lab, best_err = lab, err
            labels.append(best_lab)
        c = Counter(labels)
        tot = sum(c.values())
        out["subdivision_distribution"] = {
            k: round(c.get(k, 0) / tot, 4)
            for k in list(SUBDIVISIONS) + ["other"] if c.get(k, 0)
        }

    # Motivic repetition (repeated interval n-grams)
    out["motivic_repetition"] = {
        "n2": ngram_repetition(intervals, 2),
        "n3": ngram_repetition(intervals, 3),
        "n4": ngram_repetition(intervals, 4),
    }
    out["motivic_repetition_score"] = round(
        float(np.mean(list(out["motivic_repetition"].values()))), 4)

    # Contour
    if intervals:
        up = sum(1 for i in intervals if i > 0)
        down = sum(1 for i in intervals if i < 0)
        flat = sum(1 for i in intervals if i == 0)
        ti = len(intervals)
        signs = [1 if i > 0 else -1 if i < 0 else 0 for i in intervals]
        changes = sum(1 for a, b in zip(signs, signs[1:])
                      if a != 0 and b != 0 and a != b)
        out["contour"] = {
            "ascending_pct": round(100.0 * up / ti, 2),
            "descending_pct": round(100.0 * down / ti, 2),
            "repeat_pct": round(100.0 * flat / ti, 2),
            "direction_change_rate": round(
                changes / (ti - 1), 4) if ti > 1 else 0.0,
        }

    return out


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(
        description="Phase 1 personality analyzer — audio file -> fingerprint JSON")
    ap.add_argument("audio", help="path to audio file (wav/mp3/flac/...)")
    ap.add_argument("--label", default=None,
                    help="personality label to tag the output (e.g. garcia)")
    ap.add_argument("--bpm", type=float, default=None,
                    help="tempo; enables subdivision + per-beat density. "
                         "If omitted it is estimated.")
    ap.add_argument("--key", default=None,
                    help='override key, e.g. "A mixolydian" (default: estimate)')
    ap.add_argument("--method", default="pyin", choices=["pyin", "crepe"],
                    help="pitch tracker (pyin default; crepe needs tensorflow)")
    ap.add_argument("--out", default=None, help="output JSON path")
    ap.add_argument("--min-note-sec", type=float, default=0.05)
    ap.add_argument("--semitone-tol", type=float, default=0.65)
    ap.add_argument("--quiet", action="store_true",
                    help="don't print the summary table")
    args = ap.parse_args()

    if not os.path.isfile(args.audio):
        sys.exit(f"file not found: {args.audio}")

    times, f0_midi, voiced, duration, sr = pitch_track(
        args.audio, method=args.method)
    notes = segment_notes(times, f0_midi, voiced,
                          semitone_tol=args.semitone_tol,
                          min_note_sec=args.min_note_sec)

    bpm = args.bpm
    bpm_estimated = False
    if bpm is None:
        try:
            import librosa
            y, _sr = librosa.load(args.audio, sr=sr, mono=True)
            tempo, _ = librosa.beat.beat_track(y=y, sr=_sr)
            bpm = float(np.atleast_1d(tempo)[0])
            bpm_estimated = True
        except Exception:
            bpm = None

    if args.key:
        key_root, key_mode = parse_key(args.key)
        key_corr = None
        key_source = "user"
    else:
        kr_name, key_mode, key_corr = estimate_key(notes)
        key_root = NOTE_NAMES.index(kr_name) if kr_name else 0
        key_mode = key_mode or "major"
        key_source = "estimated"

    metrics = compute_metrics(notes, duration, bpm,
                              key_root, key_mode, key_corr)

    result = {
        "label": args.label,
        "source_file": os.path.basename(args.audio),
        "analyzer_version": ANALYZER_VERSION,
        "params": {
            "pitch_method": args.method,
            "sample_rate": sr,
            "bpm": round(bpm, 1) if bpm else None,
            "bpm_estimated": bpm_estimated,
            "key_source": key_source,
            "min_note_sec": args.min_note_sec,
            "semitone_tol": args.semitone_tol,
        },
        "metrics": metrics,
    }

    out_path = args.out
    if out_path is None:
        base = os.path.splitext(os.path.basename(args.audio))[0]
        tag = (args.label + "_") if args.label else ""
        out_path = f"{tag}{base}.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)

    if not args.quiet:
        m = metrics
        print(f"\n  {args.audio}  ({args.method}, {duration:.1f}s, "
              f"{'~' if bpm_estimated else ''}{bpm:.0f} bpm)"
              if bpm else f"\n  {args.audio}")
        print(f"  {'-'*54}")
        print(f"  notes              {m.get('note_count')}")
        print(f"  density /sec       {m.get('density_notes_per_sec')}")
        print(f"  range (semitones)  {m.get('pitch_range_semitones')} "
              f"({m.get('pitch_low')}–{m.get('pitch_high')})")
        print(f"  rest %             {m.get('rest_percentage')}")
        print(f"  key                {m.get('estimated_key')} "
              f"(conf {m.get('key_confidence')})")
        print(f"  chromaticism %     {m.get('chromaticism_pct_by_count')}")
        print(f"  mean |interval|    {m.get('interval_mean_abs')}")
        print(f"  stepwise / leap %  {m.get('pct_stepwise')} / "
              f"{m.get('pct_leaps')}")
        print(f"  phrase len (mean)  {m.get('phrase_len_mean')}")
        print(f"  rhythmic CV        {m.get('rhythmic_cv')}")
        print(f"  motivic repetition {m.get('motivic_repetition_score')}")
        print(f"  -> {out_path}\n")


if __name__ == "__main__":
    main()
