# PKGBUILD: 用本地构建产物安装 OpenCode desktop(覆盖 AUR opencode-desktop-bin)
# 包含 legacy workspace/session 切换刷新和 Linux 自定义标题栏修复。
#
# 前置:在 packages/desktop 完成 prod 构建
#   OPENCODE_CHANNEL=prod bun run prebuild
#   OPENCODE_CHANNEL=prod bun run build
#   OPENCODE_CHANNEL=prod bun run package:linux -- --dir
#
# 安装:在此文件所在目录运行
#   paru -U .
# 或
#   makepkg -si

pkgname=opencode-desktop-bin
pkgver=1.18.3
pkgrel=6
pkgdesc="OpenCode desktop client (local build with workspace refresh and Linux titlebar fixes)"
arch=('x86_64')
url="https://opencode.ai"
license=('MIT')
depends=('gtk3' 'nss' 'libxss' 'libxtst' 'alsa-lib' 'libsecret' 'libnotify' 'xdg-utils' 'ripgrep')
provides=('opencode-desktop')
conflicts=('opencode-desktop')

_local_build="$startdir/packages/desktop/dist/linux-unpacked"
_icons="$startdir/packages/desktop/resources/icons"

package() {
  # Electron app -> /opt/OpenCode
  mkdir -p "$pkgdir/opt"
  cp -a --no-preserve=ownership "$_local_build" "$pkgdir/opt/OpenCode"

  # /usr/bin launcher (matches AUR helper script)
  install -Dm755 /dev/stdin "$pkgdir/usr/bin/opencode-desktop" <<'EOF'
#!/bin/bash
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
if [[ -f "$XDG_CONFIG_HOME/opencode-desktop-flags.conf" ]]; then
  OPENCODE_USER_FLAGS="$(grep -v '^#' "$XDG_CONFIG_HOME/opencode-desktop-flags.conf")"
fi
exec /opt/OpenCode/ai.opencode.desktop $OPENCODE_USER_FLAGS "$@"
EOF

  # Primary .desktop entry
  install -Dm644 /dev/stdin "$pkgdir/usr/share/applications/ai.opencode.desktop.desktop" <<'EOF'
[Desktop Entry]
Name=OpenCode
Exec=opencode-desktop %U
Terminal=false
Type=Application
Icon=ai.opencode.desktop
StartupWMClass=ai.opencode.desktop
MimeType=x-scheme-handler/opencode;
Categories=Development;
EOF

  # Legacy .desktop entry (keeps old GNOME/KDE pins resolving)
  install -Dm644 /dev/stdin "$pkgdir/usr/share/applications/opencode-desktop.desktop" <<'EOF'
[Desktop Entry]
Name=OpenCode
Exec=/opt/OpenCode/ai.opencode.desktop %U
Terminal=false
Type=Application
Icon=ai.opencode.desktop
StartupWMClass=ai.opencode.desktop
NoDisplay=true
Comment=Open source AI coding agent
Categories=Development;
EOF

  # hicolor icons
  install -Dm644 "$_icons/32x32.png"   "$pkgdir/usr/share/icons/hicolor/32x32/apps/ai.opencode.desktop.png"
  install -Dm644 "$_icons/64x64.png"   "$pkgdir/usr/share/icons/hicolor/64x64/apps/ai.opencode.desktop.png"
  install -Dm644 "$_icons/128x128.png" "$pkgdir/usr/share/icons/hicolor/128x128/apps/ai.opencode.desktop.png"
}
