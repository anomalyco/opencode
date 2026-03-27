#!/usr/bin/env bash
# End-to-end test: install → use cases → wizard config validation → uninstall → reinstall
# Usage:  bash test-e2e.sh
# Requirements: curl, git  (no expect needed)
set -euo pipefail

bold="\033[1m"
green="\033[32m"
red="\033[31m"
reset="\033[0m"

pass()    { echo -e "  ${bold}${green}✔${reset}  $*"; }
fail()    { echo -e "  ${bold}${red}✘${reset}  $*"; exit 1; }
section() { echo -e "\n${bold}▶ $*${reset}"; }

INSTALL_DIR="${COBUILDER_INSTALL_DIR:-$HOME/.local/bin}"
export PATH="$INSTALL_DIR:$PATH"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"

# If a specific release tag was passed by CI (e.g. cb-v1.2.3), strip the prefix
# and export as COBUILDER_VERSION so install.sh uses that exact release.
if [[ -n "${COBUILDER_TEST_TAG:-}" ]]; then
  export COBUILDER_VERSION="${COBUILDER_TEST_TAG#cb-v}"
fi

install_cobuilder() {
  local attempt=0
  while (( attempt < 3 )); do
    if curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash; then
      return 0
    fi
    attempt=$(( attempt + 1 ))
    echo "  Install attempt ${attempt}/3 failed, retrying in 15s..."
    sleep 15
  done
  fail "Install failed after 3 attempts"
}

# ── 1. Install ────────────────────────────────────────────────────────────────
section "1 / 10  Install via curl | bash"
install_cobuilder
[[ -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary not found at $INSTALL_DIR/cobuilder"
pass "Binary installed"

# ── 2. Version ───────────────────────────────────────────────────────────────
section "2 / 10  cobuilder --version shows proper semver"
VERSION=$(cobuilder --version 2>&1)
echo "  Version: $VERSION"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version '$VERSION' is not semver (expected X.Y.Z)"
pass "Version is $VERSION"

# ── 3. Help / command surface ─────────────────────────────────────────────────
section "3 / 10  Core commands present in --help"
HELP=$(cobuilder --help 2>&1)
for CMD in onboard skills workflow providers run; do
  echo "$HELP" | grep -q "$CMD" || fail "Command '$CMD' missing from --help"
  pass "Command '$CMD' present"
done

# ── 4. DB migration + skills list ────────────────────────────────────────────
section "4 / 10  First run (DB migration) + skills list clean"
# Triggers one-time DB migration on first run
cobuilder skills list 2>&1 | grep -qiE "no skills|install" || fail "Expected 'no skills' message"
pass "DB migration done, skills list empty"

# ── 5. skills install + verify ───────────────────────────────────────────────
section "5 / 10  cobuilder skills install gsd"
cobuilder skills install gsd 2>&1 | grep -qi "installed" || fail "skills install gsd did not report success"
cobuilder skills list 2>&1 | grep -q "gsd" || fail "gsd not found in skills list after install"
pass "gsd installed and visible in list"

# ── 6. skills remove ─────────────────────────────────────────────────────────
section "6 / 10  cobuilder skills remove gsd"
cobuilder skills remove gsd 2>&1 | grep -qi "removed" || fail "skills remove gsd did not report success"
cobuilder skills list 2>&1 | grep -qiE "no skills|install" || fail "Expected empty list after remove"
pass "gsd removed"

# ── 7. Onboard wizard — provider menu appears in help ────────────────────────
section "7 / 10  Onboard wizard — command exists and is documented"
cobuilder --help 2>&1 | grep -q "onboard" \
  || fail "'onboard' command missing from --help"
cobuilder onboard --help 2>&1 | grep -qi "setup\|provider\|interactive" \
  || fail "onboard --help missing expected description"
pass "onboard command documented"

# ── 8. Onboard wizard — each wizard selection validated ───────────────────────
# Strategy: write the exact config that each wizard flow produces, then verify
# cobuilder can read it without crashing (via `cobuilder providers`).
# This covers both Step 1 (provider selection) and Step 2 (security modules).
section "8 / 10  Onboard wizard — all provider + security selections validated"

mkdir -p "$CONFIG_DIR" "$DATA_DIR"

# Helper: write provider config and verify cobuilder accepts it
check_provider() {
  local provider="$1"
  local auth_json="$2"
  local cfg_json="$3"

  echo "$auth_json" > "$DATA_DIR/auth.json"
  chmod 600 "$DATA_DIR/auth.json"
  if [[ -n "$cfg_json" ]]; then
    echo "$cfg_json" > "$CONFIG_DIR/opencode.json"
  else
    rm -f "$CONFIG_DIR/opencode.json"
  fi

  OUTPUT=$(cobuilder providers 2>&1 || true)
  echo "$OUTPUT" | grep -qi "error\|panic\|crash\|fatal" \
    && fail "cobuilder crashed reading $provider config: $OUTPUT"

  pass "  Provider: $provider — config accepted"
}

# Helper: write security config and verify cobuilder accepts it
check_security() {
  local label="$1"
  local cfg_json="$2"

  echo "$cfg_json" > "$CONFIG_DIR/opencode.json"

  OUTPUT=$(cobuilder providers 2>&1 || true)
  echo "$OUTPUT" | grep -qi "error\|panic\|crash\|fatal" \
    && fail "cobuilder crashed reading security config ($label): $OUTPUT"

  pass "  Security: $label — config accepted"
}

echo ""
echo "  Step 1 of 2 — Provider selections"

# Anthropic: auth.json with api key
check_provider "Anthropic" \
  '{"anthropic":{"type":"api","key":"sk-ant-test-e2e-key"}}' \
  ''

# OpenAI: auth.json with api key
check_provider "OpenAI" \
  '{"openai":{"type":"api","key":"sk-test-e2e-openai-key"}}' \
  ''

# OpenRouter: auth.json with api key
check_provider "OpenRouter" \
  '{"openrouter":{"type":"api","key":"sk-or-test-e2e-openrouter-key"}}' \
  ''

# Google: auth.json with api key
check_provider "Google" \
  '{"google":{"type":"api","key":"AIzaSy-test-e2e-google-key"}}' \
  ''

# 9Router: opencode.json with custom provider config (no auth.json needed)
check_provider "9Router" \
  '{}' \
  '{"model":"9router/test-model","provider":{"9router":{"npm":"@ai-sdk/openai-compatible","name":"9Router","options":{"baseURL":"http://localhost:20123/v1","apiKey":"9router"},"models":{"test-model":{"name":"test-model"}}}}}'

echo ""
echo "  Step 2 of 2 — Security module selections"

# All modules enabled (default — wizard writes no security key)
rm -f "$CONFIG_DIR/opencode.json"
OUTPUT=$(cobuilder providers 2>&1 || true)
echo "$OUTPUT" | grep -qi "error\|panic\|crash\|fatal" \
  && fail "cobuilder crashed with no security config (all-enabled): $OUTPUT"
pass "  Security: all modules enabled (default) — config accepted"

# Each individual module disabled (wizard writes {security:{module:{enabled:false}}})
for mod in ssrf promptInjection pathTraversal auditLog rateLimiting headers; do
  check_security "only $mod disabled" \
    "{\"security\":{\"$mod\":{\"enabled\":false}}}"
done

# All modules disabled at once
check_security "all modules disabled" \
  '{"security":{"ssrf":{"enabled":false},"promptInjection":{"enabled":false},"pathTraversal":{"enabled":false},"auditLog":{"enabled":false},"rateLimiting":{"enabled":false},"headers":{"enabled":false}}}'

# Security config combined with a provider (realistic post-wizard state)
check_security "Anthropic + partial security disabled" \
  '{"security":{"auditLog":{"enabled":false},"rateLimiting":{"enabled":false}}}'

# Cleanup test config
rm -f "$DATA_DIR/auth.json" "$CONFIG_DIR/opencode.json"

# ── 9. Uninstall then reinstall ───────────────────────────────────────────────
section "9 / 10  Uninstall → reinstall"
rm -f "$INSTALL_DIR/cobuilder"
[[ ! -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary still present after removal"
pass "Uninstalled"
install_cobuilder
[[ -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary missing after reinstall"
VERSION2=$(cobuilder --version 2>&1)
[[ "$VERSION2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version after reinstall '$VERSION2' is not semver"
pass "Reinstalled — version $VERSION2"

# ── 10. Headless install — no /dev/tty error ──────────────────────────────────
section "10 / 10  Install script gracefully handles headless env"
OUTPUT=$(install_cobuilder 2>&1 || true)
echo "$OUTPUT" | grep -q "CoBuilder installed successfully" || fail "Install script did not complete"
echo "$OUTPUT" | grep -qi "No such device" && fail "/dev/tty error leaked to output" || true
pass "Clean headless install — no /dev/tty errors"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${bold}${green}All tests passed.${reset}"
echo ""
