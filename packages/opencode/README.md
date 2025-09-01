# opencode package

To install dependencies:

```bash
bun install
```

Development:

```bash
bun run --conditions=development packages/opencode/src/index.ts
```

ACP (Zed) Mode:

```bash
# start ACP JSON-RPC server over stdio
bun run packages/opencode/src/index.ts --acp

# or set env and run the installed binary
ZED_ACP=1 opencode
```

Implemented methods (JSON-RPC 2.0 over stdio):

- initialize, shutdown
- text/complete
- tool/list, tool/run (read, write, glob, bash, webfetch)
- files/read, files/write, fs/glob
- session/start, session/stop
- diagnostics/log

Notes:

- Runs headless and respects the current working directory
- Uses opencode’s existing model/tool pipeline; streaming can be added later
