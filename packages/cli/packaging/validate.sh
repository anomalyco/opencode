#!/usr/bin/env bash
# validate.sh — Validate built CLI packages in CI
#
# Usage:
#   validate.sh --deb <path>          Validate a .deb package
#   validate.sh --rpm <path>          Validate a .rpm package
#   validate.sh --version <version>   Expected version string
#
# Exit codes:
#   0  All checks passed
#   1  Validation failure

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

expected_version=""
mode=""
pkg_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deb)   mode="deb";   pkg_path="$2"; shift 2 ;;
    --rpm)   mode="rpm";   pkg_path="$2"; shift 2 ;;
    --version) expected_version="$2"; shift 2 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

if [[ -z "$mode" || -z "$pkg_path" ]]; then
  echo -e "${RED}Usage: validate.sh --deb|--rpm <path> [--version <version>]${NC}"
  exit 1
fi

if [[ ! -f "$pkg_path" ]]; then
  echo -e "${RED}Package file not found: $pkg_path${NC}"
  exit 1
fi

pass() { echo -e "${GREEN}  PASS${NC}: $1"; }
fail() { echo -e "${RED}  FAIL${NC}: $1"; exit 1; }

# ---------------------------------------------------------------------------
# DEB validation
# ---------------------------------------------------------------------------
validate_deb() {
  echo "Validating DEB: $pkg_path"

  dpkg-deb --info "$pkg_path" > /dev/null 2>&1 || fail "dpkg-deb --info failed"
  pass "Package metadata is valid"

  dpkg-deb --contents "$pkg_path" | grep -q "/usr/bin/opencode" || fail "Binary /usr/bin/opencode not found in package"
  pass "Binary /usr/bin/opencode present"

  # Check ripgrep is recommended
  local recommends
  recommends=$(dpkg-deb --field "$pkg_path" Recommends 2>/dev/null || true)
  echo "$recommends" | grep -q "ripgrep" || fail "ripgrep not in Recommends (got: $recommends)"
  pass "ripgrep listed in Recommends"

  local arch
  arch=$(dpkg-deb --field "$pkg_path" Architecture)
  [[ "$arch" == "amd64" || "$arch" == "arm64" ]] || fail "Unexpected architecture: $arch"
  pass "Architecture: $arch"

  local name
  name=$(dpkg-deb --field "$pkg_path" Package)
  [[ "$name" == "opencode" ]] || fail "Unexpected package name: $name"
  pass "Package name: $name"

  if [[ -n "$expected_version" ]]; then
    local pkg_version
    pkg_version=$(dpkg-deb --field "$pkg_path" Version)
    [[ "$pkg_version" == "$expected_version" ]] || fail "Version mismatch: expected $expected_version, got $pkg_version"
    pass "Version: $pkg_version"
  fi

  # Functional test: install and run on native arch
  if [[ "$(dpkg --print-architecture 2>/dev/null)" == "$arch" ]]; then
    echo "  Running functional test (native arch)..."
    sudo dpkg -i "$pkg_path" || sudo apt-get install -f -y
    local installed_version
    installed_version=$(opencode --version 2>/dev/null || echo "")
    if [[ -n "$expected_version" && "$installed_version" != "$expected_version" ]]; then
      fail "Installed version mismatch: expected $expected_version, got $installed_version"
    fi
    pass "Functional test: opencode --version = $installed_version"
    sudo dpkg -r opencode 2>/dev/null || true
  else
    echo "  Skipping functional test (cross-arch package)"
  fi

  echo -e "${GREEN}DEB validation passed${NC}"
}

# ---------------------------------------------------------------------------
# RPM validation
# ---------------------------------------------------------------------------
validate_rpm() {
  echo "Validating RPM: $pkg_path"

  rpm -qip "$pkg_path" > /dev/null 2>&1 || fail "rpm -qip failed"
  pass "Package metadata is valid"

  rpm -qlp "$pkg_path" | grep -q "/usr/bin/opencode" || fail "Binary /usr/bin/opencode not found in package"
  pass "Binary /usr/bin/opencode present"

  # Check ripgrep is a recommended (weak) dependency
  local rpm_recommends
  rpm_recommends=$(rpm -qp --recommends "$pkg_path" 2>/dev/null || true)
  echo "$rpm_recommends" | grep -q "ripgrep" || fail "ripgrep not in RPM Recommends (got: $rpm_recommends)"
  pass "ripgrep listed in Recommends"

  local arch
  arch=$(rpm -qp --qf '%{ARCH}' "$pkg_path")
  [[ "$arch" == "x86_64" || "$arch" == "aarch64" ]] || fail "Unexpected architecture: $arch"
  pass "Architecture: $arch"

  local name
  name=$(rpm -qp --qf '%{NAME}' "$pkg_path")
  [[ "$name" == "opencode" ]] || fail "Unexpected package name: $name"
  pass "Package name: $name"

  if [[ -n "$expected_version" ]]; then
    local pkg_version
    pkg_version=$(rpm -qp --qf '%{VERSION}' "$pkg_path")
    [[ "$pkg_version" == "$expected_version" ]] || fail "Version mismatch: expected $expected_version, got $pkg_version"
    pass "Version: $pkg_version"
  fi

  echo -e "${GREEN}RPM validation passed${NC}"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$mode" in
  deb) validate_deb ;;
  rpm) validate_rpm ;;
esac
