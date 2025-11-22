#!/usr/bin/env python3
"""
Python SDK publishing helper.

- Builds sdist and wheel using `python -m build` into dist/
- Uploads using twine. Configure either TestPyPI or PyPI via environment:

Environment variables:
  REPOSITORY   : "pypi" (default) or "testpypi"
  PYPI_TOKEN   : API token (e.g., pypi-XXXX). For TestPyPI, use the TestPyPI token.

Examples:
  REPOSITORY=testpypi PYPI_TOKEN=${{TEST_PYPI_API_TOKEN}} uv run --project packages/sdk/python python packages/sdk/python/scripts/publish.py
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def main() -> int:
    sdk_dir = Path(__file__).resolve().parent.parent
    repo = os.environ.get("REPOSITORY", "pypi").strip()
    token = os.environ.get("PYPI_TOKEN")
    if not token:
        print("ERROR: PYPI_TOKEN not set", flush=True)
        return 1

    dist = sdk_dir / "dist"
    if dist.exists():
        for f in dist.iterdir():
            f.unlink()

    # Build
    run(["python", "-m", "build"], cwd=sdk_dir)

    # Upload
    repo_url = {
        "pypi": "https://upload.pypi.org/legacy/",
        "testpypi": "https://test.pypi.org/legacy/",
    }.get(repo, repo)

    env = os.environ.copy()
    env["TWINE_USERNAME"] = "__token__"
    env["TWINE_PASSWORD"] = token

    print(f"Uploading to {repo_url}")
    subprocess.run(
        ["python", "-m", "twine", "check", "dist/*"], cwd=sdk_dir, check=True
    )
    subprocess.run(
        ["python", "-m", "twine", "upload", "--repository-url", repo_url, "dist/*"],
        cwd=sdk_dir,
        check=True,
        env=env,
    )
    print("Publish complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
