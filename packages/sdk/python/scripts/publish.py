#!/usr/bin/env python3
"""
Placeholder for publishing the Python package to PyPI.

This will be implemented in a later phase. For now, it can:
- Build the wheel/sdist with `uv build` (once available) or `python -m build`
- Upload using `uvx twine upload dist/*` or GitHub Actions
"""
from __future__ import annotations

import sys


def main() -> int:
    print("TODO: implement PyPI publishing workflow in a later phase.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
