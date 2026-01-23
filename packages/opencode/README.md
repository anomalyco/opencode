# OpenCode Core

This package contains the OpenCode CLI and local server runtime.

## What’s inside

- CLI entrypoint and commands (`src/index.ts`, `src/cli/cmd/*`)
- Local HTTP server and routes (`src/server/*`)
- Providers/models, sessions, tools, permissions, filesystem, MCP integrations

## Development (from repo root)

```bash
bun install
bun dev
```

Common commands:

```bash
bun dev --help
bun dev serve
bun dev web
```

## Build

```bash
./packages/opencode/script/build.ts --single
```

## Tests

```bash
bun run --cwd packages/opencode test
```
