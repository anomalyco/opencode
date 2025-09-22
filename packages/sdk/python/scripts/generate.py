#!/usr/bin/env python3
"""
Generate the Opencode Python SDK using openapi-python-client and place it under src/opencode_ai.

Steps:
- Generate OpenAPI JSON from the local CLI (bun dev generate)
- Run openapi-python-client (via `uvx` if available, else fallback to PATH)
- Copy the generated module into src/opencode_ai

Requires:
- Bun installed (for `bun dev generate`)
- uv installed (recommended) to run `uvx openapi-python-client`
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True, capture_output=True, text=True)


def find_repo_root(start: Path) -> Path:
    p = start
    for _ in range(10):
        if (p / ".git").exists() or (p / "sst.config.ts").exists():
            return p
        if p.parent == p:
            break
        p = p.parent
    # Fallback: assume 4 levels up from scripts/
    return start.parents[4]


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    sdk_dir = script_dir.parent
    repo_root = find_repo_root(script_dir)
    opencode_dir = repo_root / "packages" / "opencode"

    openapi_json = sdk_dir / "openapi.json"
    build_dir = sdk_dir / ".build"
    out_pkg_dir = sdk_dir / "src" / "opencode_ai"

    build_dir.mkdir(parents=True, exist_ok=True)
    (sdk_dir / "src").mkdir(parents=True, exist_ok=True)

    # 1) Generate OpenAPI spec using the CLI
    print("Generating OpenAPI spec via 'bun dev generate' ...")
    try:
        proc = run(["bun", "dev", "generate"], cwd=opencode_dir)
    except subprocess.CalledProcessError as e:
        print(e.stdout)
        print(e.stderr, file=sys.stderr)
        print("ERROR: Failed to run 'bun dev generate'. Ensure Bun is installed and available in PATH.", file=sys.stderr)
        return 1

    try:
        # Validate JSON before writing
        json.loads(proc.stdout)
    except json.JSONDecodeError as je:
        print("ERROR: Output from 'bun dev generate' was not valid JSON:", file=sys.stderr)
        print(str(je), file=sys.stderr)
        return 1

    openapi_json.write_text(proc.stdout)
    print(f"Wrote OpenAPI spec to {openapi_json}")

    # 2) Run openapi-python-client
    print("Running openapi-python-client generate ...")
    # Prefer uvx if available
    use_uvx = shutil.which("uvx") is not None
    cmd = (
        ["uvx", "openapi-python-client", "generate"] if use_uvx else ["openapi-python-client", "generate"]
    ) + [
        "--path",
        str(openapi_json),
        "--output-path",
        str(build_dir),
        "--overwrite",
    ]

    try:
        run(cmd, cwd=sdk_dir)
    except subprocess.CalledProcessError as e:
        print(e.stdout)
        print(e.stderr, file=sys.stderr)
        print(
            "ERROR: Failed to run openapi-python-client. Install uv and try again: curl -LsSf https://astral.sh/uv/install.sh | sh",
            file=sys.stderr,
        )
        return 1

    # 3) Locate generated module directory and copy to src/opencode_ai
    # The generator outputs a project directory containing the module
    # Find a subdir containing an __init__.py and (ideally) a client module
    generated_module: Path | None = None
    for candidate in build_dir.rglob("__init__.py"):
        if candidate.parent.name.startswith("."):
            continue
        # Heuristic: look for a typical client module next to __init__.py
        siblings = {p.name for p in candidate.parent.glob("*.py")}
        if "client.py" in siblings or "api_client.py" in siblings:
            generated_module = candidate.parent
            break

    if not generated_module:
        print("ERROR: Could not locate generated module directory in .build", file=sys.stderr)
        return 1

    print(f"Found generated module at {generated_module}")

    # Clean target then copy
    if out_pkg_dir.exists():
        shutil.rmtree(out_pkg_dir)
    shutil.copytree(generated_module, out_pkg_dir)
    print(f"Copied generated client to {out_pkg_dir}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
