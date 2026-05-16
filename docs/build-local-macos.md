# Build & Install opencode locally (macOS)

## Prerequisites

- [Bun](https://bun.sh) installed
- macOS (arm64 or x64)

## Build

```bash
# From repo root
OPENCODE_VERSION=1.15.2 bun run --cwd packages/opencode build --single
```

- `OPENCODE_VERSION` — set bất kỳ string nào, mặc định là `0.0.0-dev-<timestamp>`
- `--single` — chỉ build cho platform hiện tại (nhanh hơn)
- `--skip-embed-web-ui` — bỏ qua embed web UI, **không dùng** nếu cần TUI (slash commands, arrow keys)

Binary output: `packages/opencode/dist/opencode-darwin-<arch>/bin/opencode`

## Install global (symlink)

```bash
# Copy binary ra chỗ cố định
mkdir -p ~/.local/share/opencode/bin
cp packages/opencode/dist/opencode-darwin-$(uname -m | sed 's/x86_64/x64/')/bin/opencode ~/.local/share/opencode/bin/opencode
chmod +x ~/.local/share/opencode/bin/opencode

# Symlink vào /usr/local/bin
sudo ln -sf ~/.local/share/opencode/bin/opencode /usr/local/bin/opencode

# Verify
opencode --version
```

## Update

Build lại rồi copy đè:

```bash
OPENCODE_VERSION=1.15.3 bun run --cwd packages/opencode build --single
cp packages/opencode/dist/opencode-darwin-$(uname -m | sed 's/x86_64/x64/')/bin/opencode \
   ~/.local/share/opencode/bin/opencode
```

Symlink không cần tạo lại.

## Uninstall

```bash
sudo rm /usr/local/bin/opencode
rm -rf ~/.local/share/opencode/bin
```
