# opencode

## Install

```bash
bun install
```

## Run from source

```bash
bun run dev
```

This runs `src/index.ts` directly with Bun and is the fastest way to check whether a behavior is a source/runtime issue or only shows up in compiled binaries.

## Build a local binary

Build a single binary for the current machine:

```bash
bun run build -- --single --skip-install
```

The binary will be written to:

```bash
dist/opencode-<os>-<arch>/bin/opencode
```

For example on Apple Silicon macOS:

```bash
dist/opencode-darwin-arm64/bin/opencode
```

If you want the build script to refresh platform packages before compiling, drop `--skip-install`.

## Validate a compiled binary

You can smoke test a compiled binary without starting the full UI by using the debug agent command:

```bash
./dist/opencode-darwin-arm64/bin/opencode debug agent explore --tool read --params '{"filePath":"/absolute/path/to/file"}'
./dist/opencode-darwin-arm64/bin/opencode debug agent explore --tool glob --params '{"pattern":"**/*.ts","path":"/absolute/path"}'
./dist/opencode-darwin-arm64/bin/opencode debug agent explore --tool bash --params '{"command":"pwd","workdir":"/absolute/path","description":"Print working directory"}'
```

## Compile stability note

The compiled binary is more sensitive than `bun run dev` to certain export shapes. The truncation service now uses direct named exports for the service class and layer wiring instead of namespace-style access like `Truncate.Service.use(...)`. If a future compile-only regression appears in this area, first compare source mode and compiled mode before changing runtime logic.
