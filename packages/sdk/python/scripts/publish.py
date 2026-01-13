#!/usr/bin/env python3
"""
PyPI 배포 스크립트

Usage:
    # 로컬 테스트 (editable install)
    python scripts/publish.py --local

    # TestPyPI에 배포 (테스트)
    python scripts/publish.py --test

    # PyPI에 배포 (프로덕션)
    python scripts/publish.py --prod

    # 빌드만 (배포 없이)
    python scripts/publish.py --build-only

    # 버전 업데이트
    python scripts/publish.py --bump patch  # 1.1.15 -> 1.1.16
    python scripts/publish.py --bump minor  # 1.1.15 -> 1.2.0
    python scripts/publish.py --bump major  # 1.1.15 -> 2.0.0

Requirements:
    pip install build twine
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PYPROJECT = ROOT / "pyproject.toml"


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, cwd=ROOT, text=True)


def get_version() -> str:
    content = PYPROJECT.read_text()
    match = re.search(r'version\s*=\s*"([^"]+)"', content)
    if not match:
        raise ValueError("Version not found in pyproject.toml")
    return match.group(1)


def set_version(version: str) -> None:
    content = PYPROJECT.read_text()
    new_content = re.sub(r'version\s*=\s*"[^"]+"', f'version = "{version}"', content)
    PYPROJECT.write_text(new_content)

    init_file = ROOT / "opencode_sdk" / "__init__.py"
    if init_file.exists():
        init_content = init_file.read_text()
        new_init = re.sub(r'__version__\s*=\s*"[^"]+"', f'__version__ = "{version}"', init_content)
        init_file.write_text(new_init)

    print(f"Version updated to {version}")


def bump_version(bump_type: str) -> str:
    current = get_version()
    parts = current.split(".")
    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])

    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    elif bump_type == "patch":
        patch += 1
    else:
        raise ValueError(f"Invalid bump type: {bump_type}")

    new_version = f"{major}.{minor}.{patch}"
    set_version(new_version)
    return new_version


def clean() -> None:
    print("Cleaning build artifacts...")
    dirs = ["dist", "build", "*.egg-info"]
    for pattern in dirs:
        for path in ROOT.glob(pattern):
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()


def check_tools() -> bool:
    missing = []
    for tool in ["build", "twine"]:
        result = subprocess.run(
            [sys.executable, "-m", tool, "--help"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            missing.append(tool)

    if missing:
        print(f"Missing tools: {', '.join(missing)}")
        print(f"Install with: pip install {' '.join(missing)}")
        return False
    return True


def run_tests() -> bool:
    print("\n=== Running tests ===")
    result = run([sys.executable, "-m", "pytest", "tests/", "-v"], check=False)
    return result.returncode == 0


def build() -> bool:
    print("\n=== Building package ===")
    clean()
    result = run([sys.executable, "-m", "build"], check=False)
    if result.returncode != 0:
        print("Build failed!")
        return False

    print("\n=== Build artifacts ===")
    for f in (ROOT / "dist").iterdir():
        print(f"  {f.name}")
    return True


def local_install() -> None:
    print("\n=== Installing locally (editable) ===")
    run([sys.executable, "-m", "pip", "install", "-e", "."])
    print("\nLocal install complete! Test with:")
    print("  python -c 'import opencode_sdk; print(opencode_sdk.__version__)'")


def publish_test() -> None:
    print("\n=== Publishing to TestPyPI ===")
    run([
        sys.executable, "-m", "twine", "upload",
        "--repository", "testpypi",
        "dist/*",
    ])
    version = get_version()
    print(f"\nPublished to TestPyPI!")
    print(f"Install with: pip install -i https://test.pypi.org/simple/ opencode-sdk=={version}")


def publish_prod() -> None:
    print("\n=== Publishing to PyPI ===")
    confirm = input("Are you sure you want to publish to PyPI? (yes/no): ")
    if confirm.lower() != "yes":
        print("Aborted.")
        return

    run([sys.executable, "-m", "twine", "upload", "dist/*"])
    version = get_version()
    print(f"\nPublished to PyPI!")
    print(f"Install with: pip install opencode-sdk=={version}")


def main() -> None:
    parser = argparse.ArgumentParser(description="PyPI publish script")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--local", action="store_true", help="Local editable install")
    group.add_argument("--test", action="store_true", help="Publish to TestPyPI")
    group.add_argument("--prod", action="store_true", help="Publish to PyPI")
    group.add_argument("--build-only", action="store_true", help="Build only")
    group.add_argument("--bump", choices=["patch", "minor", "major"], help="Bump version")

    parser.add_argument("--skip-tests", action="store_true", help="Skip running tests")

    args = parser.parse_args()

    print(f"Current version: {get_version()}")

    if args.bump:
        new_version = bump_version(args.bump)
        print(f"New version: {new_version}")
        return

    if args.local:
        local_install()
        return

    if not check_tools():
        sys.exit(1)

    if not args.skip_tests:
        if not run_tests():
            print("\nTests failed! Fix tests before publishing.")
            sys.exit(1)

    if not build():
        sys.exit(1)

    if args.build_only:
        print("\nBuild complete!")
        return

    if args.test:
        publish_test()
    elif args.prod:
        publish_prod()


if __name__ == "__main__":
    main()
