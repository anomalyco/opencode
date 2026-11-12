#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
archives=$1 aur=$2
base="https://github.com/anomalyco/opencode/releases/download/v$OPENCODE_VERSION"
x64=$(sha256 "$archives/opencode-linux-x64.tar.gz" | cut -c1-64)
arm64=$(sha256 "$archives/opencode-linux-arm64.tar.gz" | cut -c1-64)
cat > "$aur/PKGBUILD" <<EOF
pkgname=opencode-bin
pkgver=$OPENCODE_VERSION
pkgrel=1
pkgdesc='The AI coding agent built for the terminal.'
url='https://github.com/anomalyco/opencode'
arch=('aarch64' 'x86_64')
license=('MIT')
provides=('opencode')
conflicts=('opencode')
depends=('ripgrep')
source_x86_64=('opencode-bin-$OPENCODE_VERSION-x86_64.tar.gz::$base/opencode-linux-x64.tar.gz')
source_aarch64=('opencode-bin-$OPENCODE_VERSION-aarch64.tar.gz::$base/opencode-linux-arm64.tar.gz')
sha256sums_x86_64=('$x64')
sha256sums_aarch64=('$arm64')
package() { install -Dm755 ./opencode "\$pkgdir/usr/bin/opencode"; }
EOF
cat > "$aur/.SRCINFO" <<EOF
pkgbase = opencode-bin
	pkgdesc = The AI coding agent built for the terminal.
	pkgver = $OPENCODE_VERSION
	pkgrel = 1
	url = https://github.com/anomalyco/opencode
	arch = aarch64
	arch = x86_64
	license = MIT
	depends = ripgrep
	provides = opencode
	conflicts = opencode
	source_x86_64 = opencode-bin-$OPENCODE_VERSION-x86_64.tar.gz::$base/opencode-linux-x64.tar.gz
	sha256sums_x86_64 = $x64
	source_aarch64 = opencode-bin-$OPENCODE_VERSION-aarch64.tar.gz::$base/opencode-linux-arm64.tar.gz
	sha256sums_aarch64 = $arm64

pkgname = opencode-bin
EOF
