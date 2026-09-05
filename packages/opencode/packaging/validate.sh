#!/usr/bin/env bash
# validate.sh — Validate built CLI packages in CI
#
# Usage:
#   validate.sh --deb <path>          Validate a .deb package
#   validate.sh --rpm <path>          Validate a .rpm package
#   validate.sh --pkg <path>          Validate a macOS .pkg package
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
    --pkg)   mode="pkg";   pkg_path="$2"; shift 2 ;;
    --version) expected_version="$2"; shift 2 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

if [[ -z "$mode" || -z "$pkg_path" ]]; then
  echo -e "${RED}Usage: validate.sh --deb|--rpm|--pkg <path> [--version <version>]${NC}"
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

  # Check metadata is readable
  dpkg-deb --info "$pkg_path" > /dev/null 2>&1 || fail "dpkg-deb --info failed"
  pass "Package metadata is valid"

  # Check binary is included
  dpkg-deb --contents "$pkg_path" | grep -q "/usr/bin/opencode" || fail "Binary /usr/bin/opencode not found in package"
  pass "Binary /usr/bin/opencode present"

  # Check completions are included
  dpkg-deb --contents "$pkg_path" | grep -q "bash-completion" || fail "Bash completions not found"
  pass "Bash completions present"

  dpkg-deb --contents "$pkg_path" | grep -q "zsh/site-functions" || fail "Zsh completions not found"
  pass "Zsh completions present"

  dpkg-deb --contents "$pkg_path" | grep -q "fish/vendor_completions" || fail "Fish completions not found"
  pass "Fish completions present"

  # Check dependency on ripgrep
  local deps
  deps=$(dpkg-deb --field "$pkg_path" Depends)
  echo "$deps" | grep -q "ripgrep" || fail "Dependency on ripgrep not declared (Depends: $deps)"
  pass "Dependency on ripgrep declared"

  # Check architecture field
  local arch
  arch=$(dpkg-deb --field "$pkg_path" Architecture)
  [[ "$arch" == "amd64" || "$arch" == "arm64" ]] || fail "Unexpected architecture: $arch"
  pass "Architecture: $arch"

  # Check package name
  local name
  name=$(dpkg-deb --field "$pkg_path" Package)
  [[ "$name" == "opencode" ]] || fail "Unexpected package name: $name"
  pass "Package name: $name"

  # Check version if provided
  if [[ -n "$expected_version" ]]; then
    local pkg_version
    pkg_version=$(dpkg-deb --field "$pkg_path" Version)
    [[ "$pkg_version" == "$expected_version" ]] || fail "Version mismatch: expected $expected_version, got $pkg_version"
    pass "Version: $pkg_version"
  fi

  # Functional test: install and run on native arch
  if [[ "$(dpkg --print-architecture 2>/dev/null)" == "$arch" ]]; then
    echo "  Running functional test (native arch)..."
    sudo dpkg -i "$pkg_path" 2>/dev/null || sudo apt-get install -f -y 2>/dev/null
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

  # Check metadata is readable
  rpm -qip "$pkg_path" > /dev/null 2>&1 || fail "rpm -qip failed"
  pass "Package metadata is valid"

  # Check binary is included
  rpm -qlp "$pkg_path" | grep -q "/usr/bin/opencode" || fail "Binary /usr/bin/opencode not found in package"
  pass "Binary /usr/bin/opencode present"

  # Check completions are included
  rpm -qlp "$pkg_path" | grep -q "bash-completion" || fail "Bash completions not found"
  pass "Bash completions present"

  rpm -qlp "$pkg_path" | grep -q "zsh/site-functions" || fail "Zsh completions not found"
  pass "Zsh completions present"

  rpm -qlp "$pkg_path" | grep -q "fish/vendor_completions" || fail "Fish completions not found"
  pass "Fish completions present"

  # Check dependency on ripgrep
  local deps
  deps=$(rpm -qRp "$pkg_path")
  echo "$deps" | grep -q "ripgrep" || fail "Dependency on ripgrep not declared"
  pass "Dependency on ripgrep declared"

  # Check architecture
  local arch
  arch=$(rpm -qp --qf '%{ARCH}' "$pkg_path")
  [[ "$arch" == "x86_64" || "$arch" == "aarch64" ]] || fail "Unexpected architecture: $arch"
  pass "Architecture: $arch"

  # Check package name
  local name
  name=$(rpm -qp --qf '%{NAME}' "$pkg_path")
  [[ "$name" == "opencode" ]] || fail "Unexpected package name: $name"
  pass "Package name: $name"

  # Check version if provided
  if [[ -n "$expected_version" ]]; then
    local pkg_version
    pkg_version=$(rpm -qp --qf '%{VERSION}' "$pkg_path")
    [[ "$pkg_version" == "$expected_version" ]] || fail "Version mismatch: expected $expected_version, got $pkg_version"
    pass "Version: $pkg_version"
  fi

  echo -e "${GREEN}RPM validation passed${NC}"
}

# ---------------------------------------------------------------------------
# macOS .pkg validation
# ---------------------------------------------------------------------------
validate_pkg() {
  echo "Validating PKG: $pkg_path"

  # Check the package is a valid xar archive
  pkgutil --check-signature "$pkg_path" > /dev/null 2>&1
  local sig_status=$?
  if [[ $sig_status -eq 0 ]]; then
    local sig_output
    sig_output=$(pkgutil --check-signature "$pkg_path" 2>&1)
    if echo "$sig_output" | grep -q "signed"; then
      pass "Package is signed"
    else
      echo "  INFO: Package signature status unclear, continuing"
    fi
  else
    echo "  INFO: Package is unsigned (acceptable for non-release builds)"
  fi

  # Check payload contains the binary
  local payload
  payload=$(pkgutil --payload-files "$pkg_path" 2>/dev/null || true)
  if [[ -n "$payload" ]]; then
    echo "$payload" | grep -q "opencode" || fail "Binary not found in package payload"
    pass "Binary found in payload"
  else
    # productbuild wraps component packages; expand and check
    local tmpdir
    tmpdir=$(mktemp -d)
    pkgutil --expand "$pkg_path" "$tmpdir/expanded" 2>/dev/null || fail "Failed to expand package"
    local found=false
    for component in "$tmpdir"/expanded/*.pkg; do
      if [[ -d "$component" ]]; then
        local comp_payload
        comp_payload=$(cat "$component/PackageInfo" 2>/dev/null || true)
        if echo "$comp_payload" | grep -q "ai.opencode.cli"; then
          found=true
          pass "Component package ai.opencode.cli found"
          break
        fi
      fi
    done
    rm -rf "$tmpdir"
    [[ "$found" == "true" ]] || fail "Component package ai.opencode.cli not found"
  fi

  # Functional test on macOS
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "  Running functional test..."
    sudo installer -pkg "$pkg_path" -target / 2>/dev/null || fail "installer -pkg failed"
    local installed_version
    installed_version=$(/usr/local/bin/opencode --version 2>/dev/null || echo "")
    if [[ -n "$expected_version" && "$installed_version" != "$expected_version" ]]; then
      fail "Installed version mismatch: expected $expected_version, got $installed_version"
    fi
    pass "Functional test: opencode --version = $installed_version"
    # Clean up installed files
    sudo rm -f /usr/local/bin/opencode
  else
    echo "  Skipping functional test (not macOS)"
  fi

  echo -e "${GREEN}PKG validation passed${NC}"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$mode" in
  deb) validate_deb ;;
  rpm) validate_rpm ;;
  pkg) validate_pkg ;;
esac
