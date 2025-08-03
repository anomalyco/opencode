#\!/bin/bash
# Test script to verify vim mode is included

echo "Checking if vim mode files are in the build..."

# Check if our vim files exist
if [ -d "packages/tui/internal/components/vim" ]; then
    echo "✓ Vim component directory exists"
    ls -la packages/tui/internal/components/vim/
else
    echo "✗ Vim component directory missing"
fi

# Check if vim command is in the commands list
if grep -q "VimModeToggleCommand" packages/tui/internal/commands/command.go; then
    echo "✓ Vim toggle command is registered"
else
    echo "✗ Vim toggle command not found"
fi

# Build the TUI to ensure it compiles
echo ""
echo "Building TUI to verify compilation..."
cd packages/tui
if go build -o test-opencode ./cmd/opencode; then
    echo "✓ TUI builds successfully with vim mode"
    rm test-opencode
else
    echo "✗ TUI build failed"
fi
