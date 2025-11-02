#!/bin/bash
# Auto-copy screenshots from Desktop to .screenshots folder

WATCH_DIR="$HOME/Desktop"
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "👀 Watching for screenshots on Desktop..."
echo "📁 Will copy to: $DEST_DIR"
echo "Press Ctrl+C to stop"
echo ""

# Watch Desktop for new screenshots
fswatch -0 "$WATCH_DIR" | while read -d "" event; do
    # Check if it's a screenshot
    if [[ "$event" == *"Screenshot"*.png ]] || [[ "$event" == *"Screenshot"*.jpg ]]; then
        filename=$(basename "$event")
        
        # Wait a moment for file to be written
        sleep 0.5
        
        if [ -f "$event" ]; then
            # Copy to screenshots folder
            cp "$event" "$DEST_DIR/$filename"
            echo "✅ Copied: $filename"
            echo "💬 Tell AI: check .screenshots/$filename"
            echo ""
        fi
    fi
done
