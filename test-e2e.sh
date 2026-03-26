#!/usr/bin/env bash
# End-to-end test: install → use cases → uninstall → reinstall
# Usage: bash test-e2e.sh
# Designed to run in a fresh environment (CI or Docker).
set -euo pipefail

bold="\033[1m"
green="\033[32m"
red="\033[31m"
reset="\033[0m"

pass() { echo -e "  ${bold}${green}✔${reset}  $*"; }
fail() { echo -e "  ${bold}${red}✘${reset}  $*"; exit 1; }
section() { echo -e "\n${bold}▶ $*${reset}"; }

INSTALL_DIR="${COBUILDER_INSTALL_DIR:-$HOME/.local/bin}"
export PATH="$INSTALL_DIR:$PATH"

# ── 1. Install ────────────────────────────────────────────────────────────────
section "1 / 7  Install via curl | bash"
curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
[[ -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary not found at $INSTALL_DIR/cobuilder"
pass "Binary installed"

# ── 2. Version ───────────────────────────────────────────────────────────────
section "2 / 7  cobuilder --version shows proper semver"
VERSION=$(cobuilder --version 2>&1)
echo "  Version: $VERSION"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version '$VERSION' is not semver (expected X.Y.Z)"
pass "Version is $VERSION"

# ── 3. Help / command surface ─────────────────────────────────────────────────
section "3 / 7  Core commands present in --help"
HELP=$(cobuilder --help 2>&1)
for CMD in onboard skills workflow providers run; do
  echo "$HELP" | grep -q "$CMD" || fail "Command '$CMD' missing from --help"
  pass "Command '$CMD' present"
done

# ── 4. skills list (empty) ───────────────────────────────────────────────────
section "4 / 7  cobuilder skills list (clean state)"
cobuilder skills list 2>&1 | grep -qiE "no skills|install" || fail "Expected 'no skills' message"
pass "skills list reports empty"

# ── 5. skills install gsd ────────────────────────────────────────────────────
section "5 / 7  cobuilder skills install gsd"
cobuilder skills install gsd 2>&1 | grep -qi "installed" || fail "skills install gsd did not report success"
pass "gsd installed"

# ── 6. skills list shows gsd ─────────────────────────────────────────────────
section "6 / 7  cobuilder skills list shows gsd"
cobuilder skills list 2>&1 | grep -q "gsd" || fail "gsd not found in skills list"
pass "gsd visible in skills list"

# ── 7. Uninstall then reinstall ───────────────────────────────────────────────
section "7 / 7  Uninstall → reinstall"
rm -f "$INSTALL_DIR/cobuilder"
[[ ! -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary still present after removal"
pass "Uninstalled"

curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
[[ -x "$INSTALL_DIR/cobuilder" ]] || fail "Binary missing after reinstall"
VERSION2=$(cobuilder --version 2>&1)
[[ "$VERSION2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version after reinstall '$VERSION2' is not semver"
pass "Reinstalled — version $VERSION2"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${bold}${green}All tests passed.${reset}"
echo ""
