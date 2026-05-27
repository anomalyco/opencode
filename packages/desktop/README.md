# YunPat Desktop

Electron desktop app for YunPat (云熙智能体).

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop dev
```

## Build

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package:mac   # or package:win / package:linux
```

Unsigned builds are suitable for small internal pilots. See [docs/independence.md](../../docs/independence.md).
