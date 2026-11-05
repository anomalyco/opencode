#!/usr/bin/env bash
# render-aur.sh <build-npm dir> <aur dir>: writes PKGBUILD, .SRCINFO and the opencode2 shim for opencode-beta.
# The package installs the published npm tarballs, so their hashes come from the build-npm artifact.
# LICENSE comes from the AUR repository itself.
. "$(dirname "$0")/lib.sh"

npm=$1 aur=$2
name=opencode-beta
pkgver="${OPENCODE_VERSION//-/.}"
if dry_run && [ ! -f "$aur/LICENSE" ]; then printf 'MIT License\n' > "$aur/LICENSE"; fi
test -s "$aur/LICENSE" || die "The AUR repository has no LICENSE"
printf '#!/bin/sh\nexec "$(dirname "$0")/opencode" "$@"\n' > "$aur/opencode2"
sum() { sha256 "$1" | cut -c1-64; }
x64=$(sum "$npm/opencode-cli-linux-x64-baseline-$OPENCODE_VERSION.tgz")
arm64=$(sum "$npm/opencode-cli-linux-arm64-$OPENCODE_VERSION.tgz")
x64_url="https://registry.npmjs.org/@opencode/cli-linux-x64-baseline/-/cli-linux-x64-baseline-$OPENCODE_VERSION.tgz"
arm64_url="https://registry.npmjs.org/@opencode/cli-linux-arm64/-/cli-linux-arm64-$OPENCODE_VERSION.tgz"
license=$(sum "$aur/LICENSE")
shim=$(sum "$aur/opencode2")

# Stripping a compiled Bun executable can damage its embedded application.
cat > "$aur/PKGBUILD" <<PKGBUILD
# Maintainer: Dax <mail@thdxr.com>
pkgname=$name
pkgver=$pkgver
pkgrel=1
pkgdesc='OpenCode beta - the AI coding agent for the terminal'
url='https://github.com/anomalyco/opencode'
arch=('x86_64' 'aarch64')
license=('MIT')
depends=('glibc' 'gcc-libs' 'ripgrep')
provides=('opencode' 'opencode2')
conflicts=('opencode' 'opencode2')
options=('!strip' '!debug')
source=('LICENSE' 'opencode2')
sha256sums=('$license' '$shim')
source_x86_64=('$name-$pkgver-x86_64.tgz::$x64_url')
sha256sums_x86_64=('$x64')
source_aarch64=('$name-$pkgver-aarch64.tgz::$arm64_url')
sha256sums_aarch64=('$arm64')

package() {
  install -Dm755 "\$srcdir/package/bin/opencode" "\$pkgdir/usr/bin/opencode"
  install -Dm755 "\$srcdir/opencode2" "\$pkgdir/usr/bin/opencode2"
  install -Dm644 "\$srcdir/LICENSE" "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE"
}
PKGBUILD

# What makepkg --printsrcinfo prints for the PKGBUILD above.
t=$'\t'
cat > "$aur/.SRCINFO" <<SRCINFO
pkgbase = $name
${t}pkgdesc = OpenCode beta - the AI coding agent for the terminal
${t}pkgver = $pkgver
${t}pkgrel = 1
${t}url = https://github.com/anomalyco/opencode
${t}arch = x86_64
${t}arch = aarch64
${t}license = MIT
${t}depends = glibc
${t}depends = gcc-libs
${t}depends = ripgrep
${t}provides = opencode
${t}provides = opencode2
${t}conflicts = opencode
${t}conflicts = opencode2
${t}options = !strip
${t}options = !debug
${t}source = LICENSE
${t}source = opencode2
${t}sha256sums = $license
${t}sha256sums = $shim
${t}source_x86_64 = $name-$pkgver-x86_64.tgz::$x64_url
${t}sha256sums_x86_64 = $x64
${t}source_aarch64 = $name-$pkgver-aarch64.tgz::$arm64_url
${t}sha256sums_aarch64 = $arm64

pkgname = $name
SRCINFO
cat "$aur/PKGBUILD" "$aur/.SRCINFO"
