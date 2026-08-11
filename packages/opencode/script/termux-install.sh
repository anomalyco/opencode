#!/data/data/com.termux/files/usr/bin/bash
# One-shot opencode bootstrap for Termux (Android).
# Run directly (curl-bash bootstrap):
#   pkg i -y curl && curl -sL -o t.sh https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/script/termux-install.sh && bash t.sh
# Uses glibc-repo's glibc-runner (grun) to run the glibc-linked linux-arm64 binary
# on Termux's bionic libc. Requires the #33010 platform mapping + grun wrapper.
set -e

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
# Skip opencode-ai's postinstall: the published package has no android->linux
# platform mapping, so it aborts and leaves a non-ELF placeholder at bin/opencode.exe.
cat > "$PREFIX/bin/opencode" <<SHIM
#!/data/data/com.termux/files/usr/bin/bash
exec grun "$DEST" "\$@"
SHIM
chmod +x "$PREFIX/bin/opencode"

echo "==> verifying"
opencode --version
