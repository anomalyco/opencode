#!/bin/bash
# Simple drag-and-drop screenshot handler

echo ""
echo "📸 Screenshot Drop Tool"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "👉 Drag screenshot here and press Enter:"
echo ""
read -r filepath

# Clean the path (remove backslashes, quotes, etc)
filepath=$(echo "$filepath" | sed 's/\\//g' | sed "s/'//g" | sed 's/"//g' | xargs)

if [ -z "$filepath" ]; then
    echo "❌ No file provided"
    exit 1
fi

if [ ! -f "$filepath" ]; then
    echo "❌ File not found: $filepath"
    exit 1
fi

# Check if it's an image
if ! file "$filepath" | grep -q "image"; then
    echo "⚠️  Warning: This doesn't look like an image file"
fi

# Generate new filename
ext="${filepath##*.}"
timestamp=$(date +%Y-%m-%d-%H-%M-%S)
newname="screenshot-${timestamp}.${ext}"

# Get the script directory
scriptdir="$(cd "$(dirname "$0")" && pwd)"

# Copy file
cp "$filepath" "$scriptdir/$newname"

echo ""
echo "✅ Saved: $newname"
echo "📁 Location: .screenshots/$newname"
echo ""
echo "💬 Tell the AI:"
echo "   check .screenshots/$newname"
echo ""
echo "📋 Or just paste this:"
echo "   .screenshots/$newname"
echo ""
