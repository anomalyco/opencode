# OpenCode Browser

A Chromium extension (Chrome, Edge, Brave, Opera, Vivaldi, Chromium, Helium, Arc) that lets AI agents use your
real browser through the `browse` MCP tools: open and drive tabs with Playwright, take screenshots, capture network
traffic, record, and hand off to you for logins, 2FA, and payments. It has no UI of its own beyond a toolbar button
and a status page; agents control it.

```
agent ── browse MCP (stdio) ── relay (127.0.0.1:19988) ── WebSocket ── extension ── chrome.debugger ── tabs
```

## Install

```sh
npx opencode-browser-cli install
```

This installs the CLI into `~/.local/share/opencode-browser` (`%LOCALAPPDATA%\opencode-browser` on Windows), adds
the `browse` MCP server to opencode's global config, copies the unpacked extension (reloading one that's already
connected), and checks which browsers and profiles have OpenCode Browser. When none does, it opens the Chrome Web
Store listing. There is nothing to pair: the extension connects to the local relay, which accepts only OpenCode
Browser's extension IDs (store `mfnicocicmmlkpjnaffgihfjhdgjkdjg`, unpacked `afeafocngkodbmaipcngoamamfmekgfo`).

For development, load `packages/browser-extension/dist` unpacked (Developer mode, **Load unpacked**); the manifest
key keeps that ID stable.

## Using it

- Agents open their own tabs, grouped at the start of the tab strip under the session's name, collapsed unless
  you're looking at one. Tabs nobody uses for 10 minutes close (`tabs_cleanup` closes them right away).
- Click the toolbar button on a tab to let agents use it (badge **ON**); click again to stop. RUN means an agent is
  working in the tab, WAIT that it's waiting for you.
- When an agent hands off (a login, a passkey), the page shows a banner; finish, then click **Continue**.
- The status page (opened on install, and the extension's **Options**) shows the relay connection and can copy
  diagnostics.

The agent guide is `cli/skills/browse/SKILL.md` (also the MCP `skill` tool).

## Test it

```sh
cd packages/browser-extension/cli
bun install && bun run build    # dist/cli.mjs, ../dist (the extension), and extension/
node dist/cli.mjs install       # from a checkout, the browse MCP server runs src/main.ts with bun
```

Load `packages/browser-extension/dist` unpacked (or let `install` reload an already loaded copy).

Then, from an agent with the `browse` tools: `session_new`, `execute` with
`await page.goto("https://example.com"); return page.title()`, `execute` with `return (await page.screenshot()).length`,
and `session_list`. `opencode-browser status` shows the relay, the extension, and every tab agents can use.

## The CLI (`cli/`, npm `opencode-browser-cli`)

Commands are `opencode-browser <command>` (or `npx opencode-browser-cli <command>`).

- **Setup** (`cli/src/setup.ts`): `install [--no-open]`, `extension` (opens the unpacked extension folder),
  `uninstall`. `install` also removes what earlier versions set up (a native messaging host, an opencode plugin,
  and an `opencode-browser` MCP entry).
- **Automation** (the rest of `cli/src`): the relay the extension connects to, and the clients that drive it:
  `execute`, `session`, `network` (capture, redacted HAR), `secrets`, `recording`, `flight-recorder`, `tabs
  cleanup`, `journal`, `doctor`, `status`, and `mcp` (the `browse` MCP server over stdio). The CLI and MCP server
  start the relay on demand.

  This was Browser Control (anomalyco/browser-control 8c80ac2), now part of OpenCode Browser: renamed, on its own
  port, accepting only OpenCode Browser's extension IDs, with files under the data root.

Logs live in `<data root>/logs/relay.log`: relay lifecycle, extension connects and disconnects (with the
extension's build), socket errors, every HTTP request with status and duration, and input timing; rotated at 1 MB.
`OPENCODE_BROWSER_DEBUG=1` adds per-CDP-message tracing to the relay's stderr. Environment overrides:
`OPENCODE_BROWSER_PORT`, `OPENCODE_BROWSER_HOME`, `OPENCODE_BROWSER_EXTENSION_ORIGINS`, `OPENCODE_BROWSER_HUMAN_INPUT`.

The relay and the extension accept WebSocket messages up to 256 MiB, as Playwright's CDP client does. The extension
fails a single command whose result is larger (for example a full-page screenshot of a very long page) instead of
sending it, and the relay logs and drops a connection that sends more instead of crashing.

Agent input looks human by default (`cli/src/human-input.ts`): each mouse move becomes a curved, eased ~60 Hz
trajectory from the last pointer position, clicks land a few pixels off center with a human settle and hold, key
presses are spaced 30-110 ms apart, and wheel scrolling glides. A click costs ~0.5-1 s instead of ~0.1 s;
`OPENCODE_BROWSER_HUMAN_INPUT=0` turns it off.

`execute` runs Playwright's API through [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
(`patchright-core`, pinned to the matching Playwright version), which never enables CDP's `Runtime` domain, so pages
can't detect the debugger that way. A page's console messages and uncaught errors are captured only after
`pageConsole.start()` (`cli/src/page-console.ts`), which makes that page detectable until `pageConsole.stop()`.
`cli/src/patchright-tuning.ts` restores Playwright's fast lookup for `count()` and `all()`; relay.log records
`patchright.tuning` if a Patchright update moves the internals it patches.

## The extension (`src/`)

| File | What it does |
| --- | --- |
| `background/agent-relay.ts` | The WebSocket link to the relay: runs its commands (CDP through `chrome.debugger`, tabs, groups, badges, recordings) and reports tab events |
| `background/agent-groups.ts`, `tab-cleanup.ts` | Agent tab groups (collapsed, at the start of the strip) and closing idle agent tabs |
| `background/debugger-hub.ts` | One debugger attachment per tab, restored after a worker restart or extension reload |
| `background/index.ts` | Toolbar button, badges, the status page's port |
| `content/page-status.ts` | The in-page banner while an agent works or waits for a handoff |
| `agent-relay/offscreen.ts` | Tab-capture recording |
| `status/` (`welcome.html`) | The status page |

## Releasing

`cli/package.json` holds the release version; the store zip and the bundled extension are stamped with it.

1. Bump `version` in `cli/package.json` and merge.
2. `cd cli && bun install && npm publish --access public` publishes `opencode-browser-cli` (`prepublishOnly` builds
   the CLI and the bundled extension).
3. `bun run package` writes `release/opencode-browser-<version>.zip`; upload it in the Chrome Web Store dashboard.

The CLI has its own lockfile so its dependencies stay out of the monorepo's; `cd cli && bun src/main.ts <command>`
runs it from source.

## Development

```sh
bun run dev       # rebuilds dist/ on change; reload the extension to pick it up
bun typecheck
```
