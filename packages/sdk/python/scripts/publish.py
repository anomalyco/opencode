#!/usr/bin/env python3
"""
Build and publish the Python SDK to PyPI.

Usage:
    python scripts/publish.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> None:
    pkg_root = Path(__file__).resolve().parent.parent

    print("Building package...")
    result = subprocess.run(
        [sys.executable, "-m", "build", "--wheel"],
        cwd=str(pkg_root),
    )
    if result.returncode != 0:
        print(f"Build failed with code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)

    print("Publishing to PyPI...")
    result = subprocess.run(
        [sys.executable, "-m", "twine", "upload", "dist/*"],
        cwd=str(pkg_root),
    )
    if result.returncode != 0:
        print(f"Publish failed with code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)

    print("Published successfully!")


if __name__ == "__main__":
    main()
