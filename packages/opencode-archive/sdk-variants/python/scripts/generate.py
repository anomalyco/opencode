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

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen


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


def write_json(path: Path, content: str) -> None:
    # Validate JSON before writing
    json.loads(content)
    path.write_text(content)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the Opencode Python SDK from OpenAPI spec.")
    parser.add_argument(
        "--source", choices=["cli", "server"], default="cli", help="Where to fetch the OpenAPI spec from"
    )
    parser.add_argument(
        "--server-url",
        default="http://localhost:4096/doc",
        help="OpenAPI document URL when --source=server",
    )
    parser.add_argument(
        "--out-spec",
        default=None,
        help="Output path for the OpenAPI spec (defaults to packages/sdk/python/openapi.json)",
    )
    parser.add_argument(
        "--only-spec",
        action="store_true",
        help="Only fetch and write the OpenAPI spec without generating the client",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    sdk_dir = script_dir.parent
    repo_root = find_repo_root(script_dir)
    opencode_dir = repo_root / "packages" / "opencode"

    openapi_json = Path(args.out_spec) if args.out_spec else (sdk_dir / "openapi.json")
    build_dir = sdk_dir / ".build"
    out_pkg_dir = sdk_dir / "src" / "opencode_ai"

    build_dir.mkdir(parents=True, exist_ok=True)
    (sdk_dir / "src").mkdir(parents=True, exist_ok=True)

    # 1) Obtain OpenAPI spec
    if args.source == "server":
        print(f"Fetching OpenAPI spec from {args.server_url} ...")
        try:
            with urlopen(args.server_url) as resp:
                if resp.status != 200:
                    print(f"ERROR: GET {args.server_url} -> HTTP {resp.status}", file=sys.stderr)
                    return 1
                text = resp.read().decode("utf-8")
        except Exception as e:
            print(f"ERROR: Failed to fetch from server: {e}", file=sys.stderr)
            return 1
        try:
            write_json(openapi_json, text)
        except json.JSONDecodeError as je:
            print("ERROR: Response from server was not valid JSON:", file=sys.stderr)
            print(str(je), file=sys.stderr)
            return 1
        print(f"Wrote OpenAPI spec to {openapi_json}")
    else:
        print("Generating OpenAPI spec via 'bun dev generate' ...")
        try:
            proc = run(["bun", "dev", "generate"], cwd=opencode_dir)
        except subprocess.CalledProcessError as e:
            print(e.stdout)
            print(e.stderr, file=sys.stderr)
            print(
                "ERROR: Failed to run 'bun dev generate'. Ensure Bun is installed and available in PATH.",
                file=sys.stderr,
            )
            return 1
        try:
            write_json(openapi_json, proc.stdout)
        except json.JSONDecodeError as je:
            print("ERROR: Output from 'bun dev generate' was not valid JSON:", file=sys.stderr)
            print(str(je), file=sys.stderr)
            return 1
        print(f"Wrote OpenAPI spec to {openapi_json}")

    if args.only_spec:
        print("Spec written; skipping client generation (--only-spec).")
        return 0

    # 2) Run openapi-python-client
    print("Running openapi-python-client generate ...")
    # Prefer uvx if available
    use_uvx = shutil.which("uvx") is not None
    cmd = (["uvx", "openapi-python-client", "generate"] if use_uvx else ["openapi-python-client", "generate"]) + [
        "--path",
        str(openapi_json),
        "--output-path",
        str(build_dir),
        "--overwrite",
        "--config",
        str(sdk_dir / "openapi-python-client.yaml"),
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
    generated_module: Path | None = None
    for candidate in build_dir.rglob("__init__.py"):
        if candidate.parent.name.startswith("."):
            continue
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

    # Inject local extras from template if present
    extras_template = sdk_dir / "templates" / "extras.py"
    if extras_template.exists():
        (out_pkg_dir / "extras.py").write_text(extras_template.read_text())

    # Patch __init__ to export OpenCodeClient if present
    init_path = out_pkg_dir / "__init__.py"
    if init_path.exists() and (out_pkg_dir / "extras.py").exists():
        init_text = (
            '"""A client library for accessing opencode\n\n'
            "This package is generated by openapi-python-client.\n"
            "A thin convenience wrapper `OpenCodeClient` is also provided.\n"
            '"""\n\n'
            "from .client import AuthenticatedClient, Client\n"
            "from .extras import OpenCodeClient\n\n"
            "__all__ = (\n"
            '    "AuthenticatedClient",\n'
            '    "Client",\n'
            '    "OpenCodeClient",\n'
            ")\n"
        )
        init_path.write_text(init_text)

    print(f"Copied generated client to {out_pkg_dir}")

    # 4) Format generated code
    try:
        run(["uv", "run", "--project", str(sdk_dir), "ruff", "check", "--select", "I", "--fix", str(out_pkg_dir)])
        run(["uv", "run", "--project", str(sdk_dir), "black", str(out_pkg_dir)])
    except subprocess.CalledProcessError as e:
        print("WARNING: formatting failed; continuing", file=sys.stderr)
        print(e.stdout)
        print(e.stderr, file=sys.stderr)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
