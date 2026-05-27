#!/usr/bin/env bash
# 从 Mac AppIcon 源图生成 favicon、Mark 与 Electron 桌面图标
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/packages/desktop-mac/YunPat/Assets.xcassets/AppIcon.appiconset/icon_512x512.png"
FAVICON_DIR="$ROOT/packages/ui/src/assets/favicon"
BRAND_DIR="$ROOT/packages/ui/src/assets/brand"
MARK_SVG="$BRAND_DIR/mark.svg"

if [ ! -f "$SRC" ]; then
  echo "Missing AppIcon source: $SRC" >&2
  exit 1
fi

mkdir -p "$FAVICON_DIR" "$BRAND_DIR"

# 矢量标（小尺寸 favicon / UI Mark）
cat > "$MARK_SVG" << 'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <path d="M140 340 Q200 120 280 200 Q360 260 380 160" stroke="#EF4444" stroke-width="44" fill="none" stroke-linecap="round"/>
  <path d="M120 280 Q240 380 360 300 Q400 260 420 380" stroke="#93C5FD" stroke-width="40" fill="none" stroke-linecap="round"/>
</svg>
SVG

cp "$MARK_SVG" "$FAVICON_DIR/favicon-v3.svg"
cp "$MARK_SVG" "$FAVICON_DIR/favicon.svg"

magick "$SRC" -resize 96x96 "$FAVICON_DIR/favicon-96x96-v3.png"
magick "$SRC" -resize 96x96 "$FAVICON_DIR/favicon-96x96.png"
magick "$SRC" -resize 180x180 "$FAVICON_DIR/apple-touch-icon-v3.png"
magick "$SRC" -resize 180x180 "$FAVICON_DIR/apple-touch-icon.png"
magick "$SRC" -define icon:auto-resize=16,32,48,64,128,256 "$FAVICON_DIR/favicon-v3.ico"
magick "$SRC" -define icon:auto-resize=16,32,48,64,128,256 "$FAVICON_DIR/favicon.ico"

magick "$SRC" -resize 96x96 "$BRAND_DIR/mark-96.png"
magick "$SRC" -resize 32x32 "$BRAND_DIR/mark-32.png"

for variant in prod dev beta; do
  DIR="$ROOT/packages/desktop/icons/$variant"
  [ -d "$DIR" ] || continue
  magick "$SRC" -resize 512x512 "$DIR/icon.png"
  magick "$SRC" -resize 1024x1024 "$DIR/dock.png"
  magick "$SRC" -resize 30x30 "$DIR/Square30x30Logo.png"
  magick "$SRC" -resize 44x44 "$DIR/Square44x44Logo.png" 2>/dev/null || magick "$SRC" -resize 44x44 "$DIR/Square44x44Logo.png"
  magick "$SRC" -resize 71x71 "$DIR/Square71x71Logo.png" 2>/dev/null || true
  magick "$SRC" -resize 89x89 "$DIR/Square89x89Logo.png"
  magick "$SRC" -resize 107x107 "$DIR/Square107x107Logo.png"
  magick "$SRC" -resize 142x142 "$DIR/Square142x142Logo.png"
  magick "$SRC" -resize 150x150 "$DIR/Square150x150Logo.png"
  magick "$SRC" -resize 284x284 "$DIR/Square284x284Logo.png" 2>/dev/null || true
  magick "$SRC" -resize 310x310 "$DIR/Square310x310Logo.png"
  magick "$SRC" -resize 50x50 "$DIR/StoreLogo.png"
  magick "$SRC" -resize 32x32 "$DIR/Square44x44Logo.png" 2>/dev/null || true
  magick "$SRC" -define icon:auto-resize=16,32,48,64,128,256 "$DIR/icon.ico"

  magick "$SRC" -resize 512x512 "$DIR/icon.icns"
done

magick "$SRC" -resize 192x192 "$FAVICON_DIR/web-app-manifest-192x192.png"
magick "$SRC" -resize 512x512 "$FAVICON_DIR/web-app-manifest-512x512.png"

echo "Brand icons synced from AppIcon."
