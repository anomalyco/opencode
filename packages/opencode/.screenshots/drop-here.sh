#!/bin/bash
# Quick script to move the latest screenshot here

# Get the most recent screenshot from Desktop
LATEST=$(ls -t ~/Desktop/Screenshot*.png 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    echo "No screenshots found on Desktop"
    exit 1
fi

# Get just the filename
FILENAME=$(basename "$LATEST")

# Move it here
mv "$LATEST" "$(dirname "$0")/$FILENAME"

echo "✅ Moved: $FILENAME"
echo "📁 Location: .screenshots/$FILENAME"
echo ""
echo "Tell the AI: 'check .screenshots/$FILENAME'"
