# Vite TUI entrypoint

From the repository root:

```sh
bun run dev:vite:live /path/to/project
```

This uses the normal CLI and its real TUI through Vite + `solid-refresh`. For an explicit server or private backend, use `dev:vite` with `--server URL` or `--standalone` respectively. Plain `dev:vite` uses normal CLI service discovery; `dev:vite:live` explicitly connects to the installed server without replacing it.

- Component edits hot-update through the existing Solid refresh runtime.
- Full reloads await TUI cleanup and reopen the original launch target (Home, `--session`, or `--continue`). They do not preserve a subsequently selected route or local UI state, and do not replay `--prompt`.
- Correcting syntax errors retries a failed reload. The backend stays alive.
- Launcher/config/dependency changes require restarting the development client.

`vite.ts` registers a Bun runtime module that supplies the Vite runner for the CLI's existing static `@opencode-ai/tui` import. This registration runs only in the dev launcher; production handlers and their import graph are unchanged. `tui.ts` owns Vite and the TUI lifecycle. `entry.ts` loads the real application source through Vite. `host.js` keeps lifecycle ownership outside Vite's reloadable module cache. No production CLI handler, TUI component, or route changes are needed.

Tested on Linux/Bun with full-app rendering, message/palette HMR, draft preservation, and native-terminal full reload/error recovery. External native-loaded plugins remain experimental across full reloads because their process-lifetime runtime mappings can retain an older Solid generation.
