#!/bin/bash
# Generate placeholder icons using ImageMagick or create blank PNGs

# Check if ImageMagick is available
if command -v convert &> /dev/null; then
    echo "Generating icons with ImageMagick..."
    convert -size 32x32 xc:#4ade80 -fill white -gravity center -pointsize 20 -annotate +0+0 "LK" 32x32.png
    convert -size 128x128 xc:#4ade80 -fill white -gravity center -pointsize 80 -annotate +0+0 "LK" 128x128.png
    convert -size 256x256 xc:#4ade80 -fill white -gravity center -pointsize 160 -annotate +0+0 "LK" 128x128@2x.png
    convert -size 512x512 xc:#4ade80 -fill white -gravity center -pointsize 320 -annotate +0+0 "LK" icon.png
    # Convert to icns for macOS
    mkdir icon.iconset
    sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
    sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
    sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
    sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
    sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
    sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
    sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
    sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
    sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
    iconutil -c icns icon.iconset
    rm -rf icon.iconset
    # Create ico for Windows
    convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
    echo "Icons generated!"
else
    echo "ImageMagick not found. Please install it or provide icons manually."
    exit 1
fi
