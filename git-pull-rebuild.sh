#!/bin/bash
# Auto git pull and rebuild script for opencode
set -e

cd /home/roy/opencode-fork

echo "Stashing local changes..."
git stash

echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
bun install

echo "Building opencode..."
./packages/opencode/script/build.ts --single

echo "Installing binary..."
sudo cp packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/bin/opencode

echo "✅ Done!"
opencode --version
