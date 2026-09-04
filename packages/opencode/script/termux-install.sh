#!/data/data/com.termux/files/usr/bin/bash
# One-shot opencode bootstrap for Termux (Android).
# Run directly (curl-bash bootstrap):
#   pkg i -y curl && curl -fsSL -o t.sh https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/script/termux-install.sh && bash t.sh
# Installs glibc-repo's glibc-runner (grun), then wraps the glibc-linked
# linux-arm64 binary so it runs on Termux's bionic libc.
set -euo pipefail

if [ -z "${PREFIX:-}" ] || ! command -v pkg >/dev/null 2>&1; then
  echo "error: this script must be run inside Termux" >&2
  exit 1
fi

echo "==> updating packages"
pkg update -y
pkg install -y nodejs-lts glibc-repo
pkg update -y
pkg install -y glibc-runner

echo "==> installing opencode (--force: binary pkg still gates on os:linux)"
npm install -g opencode-ai@latest opencode-linux-arm64@latest --force --ignore-scripts

LOC="$(npm root -g)"
DEST="$LOC/opencode-linux-arm64/bin/opencode"
chmod +x "$DEST"

echo "==> wrapping opencode so it runs through grun"
# opencode-ai's postinstall is not Termux-aware, so we install with
# --ignore-scripts and shim the linux-arm64 binary directly.
cat > "$PREFIX/bin/opencode" <<SHIM
#!/data/data/com.termux/files/usr/bin/bash
exec grun "$DEST" "\$@"
SHIM
chmod +x "$PREFIX/bin/opencode"

echo "==> verifying"
opencode --version
