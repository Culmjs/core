"""Analyze local offline captures with the upstream IRIS CLI. No playback or upload."""

import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def analyze(app, settings, captures, out):
    config_hash = digest(settings)
    require(
        config_hash
        == "9b9bbaec85c3c0a04a16d12e1c71299fe58797c42f4b24a04f6489d69b541572",
        "Use the unmodified IRIS settings from the pinned upstream release",
    )
    out.mkdir(parents=True, exist_ok=True)
    # A failed rerun must not leave the prior success marker in the output.
    (out / "summary.json").unlink(missing_ok=True)
    verdict = {
        "analyzer": "EA IRIS",
        "binarySha256": digest(app),
        "settingsSha256": config_hash,
        "args": ["-v", "clip.avi", "-p", "false", "-r", "false"],
        "runs": [],
    }
    with tempfile.TemporaryDirectory(prefix="culm-iris-") as tmp:
        for fixture, base in [
            ("achromatic", captures),
            ("saturated-red", captures / "saturated-red"),
        ]:
            for role in ["control", "limited"]:
                label = f"{fixture}-{role}"
                src = base / role
                summary = json.loads((src / "summary.json").read_text())
                clip = src / "clip.avi"
                clip_hash = digest(clip)
                require(
                    summary["clipSha256"] == clip_hash and summary["variant"] == role,
                    f"{label}: input mismatch",
                )
                require(
                    summary.get("fixture", "achromatic") == fixture,
                    f"{label}: wrong fixture",
                )
                require(
                    summary["host"]
                    == verdict.setdefault("hostSha256", summary["host"]),
                    "different capture hosts",
                )
                require(
                    summary["workerBodySha256"]
                    == verdict.setdefault("workerSha256", summary["workerBodySha256"]),
                    "different capture workers",
                )
                require(
                    (summary["fixtureWorkerBodySha256"] == summary["workerBodySha256"])
                    == (role == "limited"),
                    f"{label}: unexpected worker selection",
                )
                require(
                    summary["frames"] == 180
                    and summary["dropped"] == summary["duplicatePts"] == 0,
                    f"{label}: incomplete capture",
                )
                probe = summary["probe"]
                require(
                    (
                        probe["width"],
                        probe["height"],
                        probe["r_frame_rate"],
                        probe["pix_fmt"],
                    )
                    == (1024, 768, "30/1", "bgr24"),
                    f"{label}: unexpected video format",
                )
                cwd = Path(tmp) / label
                cwd.mkdir()
                (cwd / "clip.avi").symlink_to(clip.resolve())
                shutil.copyfile(settings, cwd / "appsettings.json")
                proc = subprocess.run(
                    [str(app), *verdict["args"]],
                    cwd=cwd,
                    capture_output=True,
                    timeout=120,
                    check=True,
                )
                log = proc.stdout + proc.stderr
                (out / f"{label}.log").write_bytes(log)
                raw = (cwd / "Results" / "clip.avi" / "framedata.csv").read_bytes()
                (out / f"{label}.csv.gz").write_bytes(gzip.compress(raw, mtime=0))
                rows = list(csv.DictReader(io.StringIO(raw.decode().replace("\0", ""))))
                require(
                    [int(row["Frame"]) for row in rows] == list(range(1, 181)),
                    f"{label}: incomplete report",
                )
                classes = {
                    axis: Counter(int(row[axis + "FrameResult"]) for row in rows)
                    for axis in ["Luminance", "Red"]
                }
                require(
                    all(set(counts) <= {0, 1, 2, 3} for counts in classes.values()),
                    "unknown IRIS classification",
                )
                overall = "FAIL" if role == "control" else "PASS"
                log_results = [
                    line.split(b"Video Overall Result: ", 1)[1].strip()
                    for line in log.splitlines()
                    if b"Video Overall Result: " in line
                ]
                got_control = classes["Luminance"][3] > 0 and (
                    classes["Red"][3] > 0
                    if fixture == "saturated-red"
                    else classes["Red"][0] == len(rows)
                )
                clear_limited = all(
                    counts[0] == len(rows) for counts in classes.values()
                )
                accepted = log_results == [overall.encode()] and (
                    got_control if role == "control" else clear_limited
                )
                verdict["runs"].append(
                    {
                        "fixture": fixture,
                        "role": role,
                        "clipSha256": clip_hash,
                        "frames": len(rows),
                        "reportSha256": hashlib.sha256(raw).hexdigest(),
                        "frameResults": classes,
                        "overall": [v.decode() for v in log_results],
                        "meetsFixtureExpectation": accepted,
                    }
                )
                print(label, classes, log_results, flush=True)
    verdict["passed"] = all(row["meetsFixtureExpectation"] for row in verdict["runs"])
    (out / "summary.json").write_text(json.dumps(verdict, indent=2) + "\n")
    require(verdict["passed"], "IRIS quality gate did not pass; review the raw reports")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ["app", "settings", "captures", "output"]:
        parser.add_argument("--" + arg, required=True, type=Path)
    args = parser.parse_args()
    analyze(args.app.resolve(), args.settings, args.captures, args.output)
