# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Prerequisites

Building the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). The desktop crate currently requires Rust 1.88 or newer. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

## Build

```bash
bun run --cwd packages/desktop tauri build
```

## Troubleshooting

### Rust compiler not found

If you see errors about Rust not being found, install it via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

If Cargo reports that the desktop crate requires a newer compiler, update Rust with:

```bash
rustup update
```
