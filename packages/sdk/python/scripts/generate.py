#!/usr/bin/env python3
"""
Generate Python SDK client from the OpenAPI spec.

Usage:
    python scripts/generate.py [--source cli]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Python SDK from OpenAPI spec")
    parser.add_argument("--source", choices=["cli", "file"], default="cli",
                        help="Source of OpenAPI spec")
    parser.add_argument("--spec-path", type=str,
                        default=str(Path(__file__).resolve().parent.parent.parent / "openapi.json"),
                        help="Path to OpenAPI JSON spec")
    args = parser.parse_args()

    pkg_root = Path(__file__).resolve().parent.parent
    spec_path = Path(args.spec_path)
    config_path = pkg_root / "openapi-python-client.yaml"

    if not spec_path.exists():
        print(f"OpenAPI spec not found at {spec_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Generating Python SDK from {spec_path}...")
    result = subprocess.run(
        [
            sys.executable, "-m", "openapi_python_client",
            "generate",
            "--path", str(spec_path),
            "--config", str(config_path),
            "--overwrite",
        ],
        cwd=str(pkg_root),
    )

    if result.returncode != 0:
        print(f"Generation failed with code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)

    print("SDK generation complete!")
    print(f"Generated code in: {pkg_root / 'src' / 'opencode_sdk' / 'gen'}")


if __name__ == "__main__":
    main()
