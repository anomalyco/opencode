#!/usr/bin/env python3
"""Regenerate the opencode_ai package from packages/sdk/openapi.json.

This script is the single source of truth for SDK regeneration. CI calls it
with `--check` and fails the build if the generated tree differs from what is
committed.

The generator's `--overwrite` would otherwise delete hand-written files in
`src/opencode_ai/`. To preserve them, every file under `scripts/_overlay/` is
copied on top of the generator output (creating or replacing the corresponding
file in the package). Adding a new hand-written file is as simple as dropping
it into `scripts/_overlay/`.

Usage:
    python scripts/generate.py                # regen in-place
    python scripts/generate.py --check        # fail if regen would change files
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
REPO_ROOT = PKG_ROOT.parent.parent.parent
OPENAPI = REPO_ROOT / "packages" / "sdk" / "openapi.json"
CONFIG = PKG_ROOT / "openapi-python-client.yaml"
OVERLAY = HERE / "_overlay"
DEST = PKG_ROOT / "src" / "opencode_ai"


def run_generator(work_dir: Path) -> Path:
    if not OPENAPI.exists():
        raise SystemExit(f"openapi.json not found at {OPENAPI}")
    if not CONFIG.exists():
        raise SystemExit(f"generator config not found at {CONFIG}")

    cmd = [
        "openapi-python-client",
        "generate",
        "--path",
        str(OPENAPI),
        "--config",
        str(CONFIG),
        "--overwrite",
    ]
    subprocess.run(cmd, cwd=work_dir, check=True)
    out = work_dir / "opencode-ai" / "opencode_ai"
    if not out.exists():
        raise SystemExit(f"generator did not produce expected output at {out}")
    return out


def apply_overlay(target: Path) -> None:
    if not OVERLAY.exists():
        return
    for src in OVERLAY.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(OVERLAY)
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def write_to(target: Path, source: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def diff(a: Path, b: Path) -> str:
    # Compare only source files; ignore caches that may exist in the live tree
    # but not in the freshly-generated copy.
    res = subprocess.run(
        [
            "diff",
            "-ruN",
            "-x",
            "__pycache__",
            "-x",
            "*.pyc",
            str(a),
            str(b),
        ],
        capture_output=True,
        text=True,
    )
    return res.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if regenerating would change any file",
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="opencode-sdk-gen-") as tmp:
        tmp_path = Path(tmp)
        produced = run_generator(tmp_path)
        apply_overlay(produced)

        if args.check:
            delta = diff(DEST, produced)
            if delta.strip():
                sys.stderr.write(
                    "Generated SDK is out of date. Run `python packages/sdk/python/scripts/generate.py` and commit.\n\n"
                )
                sys.stderr.write(delta)
                return 1
            print("opencode_ai is up to date.")
            return 0

        write_to(DEST, produced)
        print(f"Regenerated {DEST}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
