# Phase 2 — Corpus aggregator
#
# Turns a set of per-solo analyzer outputs into ONE personality
# fingerprint: per-metric mean / std / p10 / p90 / min / max, plus
# element-wise averaged distributions.
#
# Two input modes:
#   A) analyze a folder of audio files, then aggregate:
#        python aggregate.py --audio-dir solos/garcia --label garcia \
#               --key "A mixolydian" --out ../fingerprints/garcia.json
#   B) aggregate already-produced analyzer JSONs:
#        python aggregate.py --json-dir out/garcia --label garcia \
#               --out ../fingerprints/garcia.json
#
# Hand-tuning: pass --exclude a.json,b.json to drop solos where pitch
# detection clearly failed. The output JSON is plain text — eyeball the
# per-solo table the script prints and edit by hand if needed.

import argparse
import glob
import json
import os
import sys

import numpy as np

import analyze as A

# Scalar metrics aggregated across the corpus.
SCALARS = [
    "density_notes_per_sec", "density_notes_per_beat",
    "pitch_range_semitones", "rest_percentage",
    "chromaticism_pct_by_count", "chromaticism_pct_by_duration",
    "in_key_pct", "interval_mean_abs", "pct_stepwise", "pct_leaps",
    "phrase_len_mean", "phrase_len_median", "phrase_len_max",
    "rhythmic_cv", "ioi_mean_sec", "motivic_repetition_score",
]
CONTOUR_KEYS = ["ascending_pct", "descending_pct",
                "repeat_pct", "direction_change_rate"]
DISTRIBUTIONS = ["interval_distribution", "subdivision_distribution"]


def summarise(values):
    a = np.array([v for v in values if v is not None], dtype=float)
    if a.size == 0:
        return None
    return {
        "mean": round(float(a.mean()), 4),
        "std": round(float(a.std()), 4),
        "p10": round(float(np.percentile(a, 10)), 4),
        "p90": round(float(np.percentile(a, 90)), 4),
        "min": round(float(a.min()), 4),
        "max": round(float(a.max()), 4),
        "n": int(a.size),
    }


def avg_distribution(dicts):
    keys = set()
    for d in dicts:
        keys.update(d.keys())
    out = {}
    for k in keys:
        vals = [d.get(k, 0.0) for d in dicts]
        out[k] = round(float(np.mean(vals)), 4)
    s = sum(out.values()) or 1.0
    return {k: round(v / s, 4) for k, v in sorted(out.items())}


def analyze_dir(audio_dir, bpm, key):
    metrics_list, names = [], []
    exts = ("*.wav", "*.mp3", "*.flac", "*.m4a", "*.aif", "*.aiff", "*.ogg")
    files = sorted(f for e in exts
                   for f in glob.glob(os.path.join(audio_dir, e)))
    if not files:
        sys.exit(f"no audio files in {audio_dir}")
    for fp in files:
        try:
            times, f0, voiced, dur, sr = A.pitch_track(fp)
            notes = A.segment_notes(times, f0, voiced)
            if key:
                kr, km = A.parse_key(key)
                kc = None
            else:
                kn, km, kc = A.estimate_key(notes)
                kr = A.NOTE_NAMES.index(kn) if kn else 0
                km = km or "major"
            m = A.compute_metrics(notes, dur, bpm, kr, km, kc)
            metrics_list.append(m)
            names.append(os.path.basename(fp))
            print(f"  analyzed {os.path.basename(fp)}: "
                  f"{m.get('note_count')} notes")
        except Exception as e:
            print(f"  SKIPPED {os.path.basename(fp)}: {e}")
    return names, metrics_list


def load_json_dir(json_dir):
    names, metrics_list = [], []
    for fp in sorted(glob.glob(os.path.join(json_dir, "*.json"))):
        with open(fp) as f:
            data = json.load(f)
        metrics_list.append(data.get("metrics", data))
        names.append(os.path.basename(fp))
    if not metrics_list:
        sys.exit(f"no JSON files in {json_dir}")
    return names, metrics_list


def main():
    ap = argparse.ArgumentParser(
        description="Phase 2 — aggregate per-solo metrics into a fingerprint")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--audio-dir", help="folder of audio files to analyze")
    src.add_argument("--json-dir", help="folder of analyzer JSON outputs")
    ap.add_argument("--label", required=True, help="personality label")
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--key", default=None, help='e.g. "A mixolydian"')
    ap.add_argument("--exclude", default="",
                    help="comma-separated filenames to drop (failed detection)")
    ap.add_argument("--synthetic", action="store_true",
                    help="flag the fingerprint as synthetic placeholder data")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.audio_dir:
        names, metrics_list = analyze_dir(args.audio_dir, args.bpm, args.key)
    else:
        names, metrics_list = load_json_dir(args.json_dir)

    excl = {x.strip() for x in args.exclude.split(",") if x.strip()}
    kept = [(n, m) for n, m in zip(names, metrics_list)
            if n not in excl and m.get("note_count", 0) > 0]
    if not kept:
        sys.exit("nothing left after exclusions")
    names = [n for n, _ in kept]
    metrics_list = [m for _, m in kept]

    fp = {"scalars": {}, "contour": {}, "distributions": {}}
    for key in SCALARS:
        s = summarise([m.get(key) for m in metrics_list])
        if s:
            fp["scalars"][key] = s
    for ck in CONTOUR_KEYS:
        s = summarise([m.get("contour", {}).get(ck) for m in metrics_list])
        if s:
            fp["contour"][ck] = s
    for dk in DISTRIBUTIONS:
        dicts = [m[dk] for m in metrics_list if m.get(dk)]
        if dicts:
            fp["distributions"][dk] = avg_distribution(dicts)

    result = {
        "label": args.label,
        "synthetic": bool(args.synthetic),
        "analyzer_version": A.ANALYZER_VERSION,
        "corpus_size": len(metrics_list),
        "source_solos": names,
        "fingerprint": fp,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n  {args.label}: aggregated {len(metrics_list)} solos"
          f"{' [SYNTHETIC]' if args.synthetic else ''}")
    for k in ("density_notes_per_sec", "chromaticism_pct_by_count",
              "rest_percentage", "interval_mean_abs",
              "motivic_repetition_score"):
        if k in fp["scalars"]:
            s = fp["scalars"][k]
            print(f"    {k:32s} mean {s['mean']:8.3f}  "
                  f"[{s['p10']:.2f} .. {s['p90']:.2f}]")
    print(f"  -> {args.out}\n")


if __name__ == "__main__":
    main()
