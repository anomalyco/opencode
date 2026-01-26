#!/bin/bash
# ZFlow Development Launcher

echo "================================"
echo "  ZFlow Desktop - Development Mode"
echo "================================"
echo ""

# Add bun bin to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Change to project directory
cd "$(dirname "$0")"
cd ../packages/desktop

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "WARNING: Rust/Cargo not found!"
    echo "Some features may not work without Rust toolchain."
    echo ""
    echo "To install Rust:"
    echo "  1. Download rustup-init.exe from https://rustup.rs/"
    echo "  2. Run: rustup-init.exe"
    echo ""
    read -p "Continue anyway? (Y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

echo "Starting ZFlow development server..."
echo ""

# Run Tauri dev
tauri dev
