echo "Installing dependencies..."

bun install

echo "Building..."

bun run --cwd packages/opencode build --single
cp packages/opencode/dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/
codesign -s - -f ~/.opencode/bin/opencode
echo "Done!"
