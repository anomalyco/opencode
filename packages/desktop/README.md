# OpenCode Desktop

The OpenCode Desktop app, built with Electron.

## Development

```bash
bun install
bun dev
```

### Terminal app with the menu-bar companion

From the repository root, run:

```bash
bun run dev
```

The local V2 terminal app starts its service as usual, then automatically launches the bundled Electron tray entrypoint.
No desktop window or separately started server is required. New Agent and Settings act on the terminal app; session rows
select the corresponding TUI session. On macOS the companion also activates the originating terminal application when
its bundle identifier is available. Multiple terminal clients share one companion and their open sessions are combined.
The companion exits after the last terminal client exits; quitting the companion itself does not stop the TUI or server.

Opt out through **Open settings → Terminal → Menu bar / system tray**, or set `"tray": { "enabled": false }` in `cli.json`.
`OPENCODE_TRAY=0 bun run dev` disables the companion for one invocation. SSH, headless Linux, and non-interactive commands
do not launch it. The local launcher needs the normal workspace dependencies (`bun install`) and builds only the Electron
main process, not the desktop renderer. Launcher output is written to `terminal-tray.log` in the OpenCode log directory.

Packaged CLI distributions can supply an `opencode-tray` executable beside the CLI or set `OPENCODE_TRAY_EXECUTABLE` to
the companion launcher. The automatic workspace build path is specific to local source development.

### Menu bar / system tray scaffold

The desktop bundle includes a native tray companion, enabled by default. It offers **New Agent…**
(opens a new session draft), **Settings**, **Docs**, and **Quit**. Closing the last window keeps
the companion running; Quit exits the desktop process, not the shared OpenCode background service.
The icon appears as soon as Electron is ready, before shell-environment discovery and service initialization. Its startup
menu remains available while the full session menu loads, and the saved opt-out is still respected.

Above those actions, the tray shows the local-service sessions open in tabs across this desktop app's windows. It groups
them into **Needs you** and **Active sessions**, with titles, project directory names, and the last measured
context usage. Clicking a session focuses the window that already owns its tab. Duplicate tabs across windows appear once;
closed tabs, blank drafts, history-only sessions, and terminal-only sessions are excluded. All open session tabs are included,
not just the eight most recent sessions. Tab changes trigger a refresh; status and context refresh every ten seconds while
enabled. An open menu keeps its rows stable until dismissed. Connection failures are labeled and retain the last available
summary, but closing a tab still removes it.
Working sessions keep their existing position in Active sessions; their favicon is replaced with a simple working dot.

Context is the latest measured assistant step (not cumulative session tokens or task progress). If the model's context
limit is unavailable, the tray shows token usage instead; sessions without a recent measurement say **No context**.
The session's total recorded cost in USD follows the context, formatted using the active locale (for example, `Context 52% · $0.12`).
On macOS 14.4+, each session uses one native menu item with a title and secondary label. Both lines share the native hover
highlight and click target, with compact system spacing and default styling. Transparent padding below each session icon
positions the visible favicon alongside the title without changing its size, horizontal padding, or shared hover target.
Platforms without native secondary labels
retain separate title/detail rows and an invisible alignment spacer. Menu icons have an extra four-point trailing gutter.
On macOS and Linux, footer shortcuts use the operating system's separate, subdued shortcut column:
**Cmd/Ctrl+N** for New Agent, **Cmd/Ctrl+,** for Settings, and **Cmd/Ctrl+Q** for Quit. Docs has no shortcut.
They work while the tray menu is open. Windows popup menus do not respond to these shortcuts, so on Windows the footer
items are plain options without shortcut labels.

**Cmd+Option+O** opens the tray globally on macOS (**Ctrl+Alt+O** on Linux, **Win+Alt+O** on Windows), even while another
app is focused. Windows avoids Ctrl+Alt because many keyboard layouts use it as AltGr to type characters.
It is registered when the tray icon appears and released when the tray is disabled or the app quits. If another application
already owns the combination, the tray remains usable by mouse and a shortcut-registration warning is written to the log.

Session titles are single-line and ellipsized. The project name on the detail line gets the remaining text budget after
context and cost, so those values stay visible. Full titles and directories remain available in the session tooltip.
Tooltips identify **Local** or **Worktree · name** using the server-resolved checkout root, followed by the full session
directory. Usage reads **Context 52%** and **Cost $0.12**. If placement resolution fails, the tooltip says **Location unavailable**.

Session icons use the project's favicon/override, or its colored initial when no image is available. They use
the same resolved workspace icon and theme colors published by their desktop tab, including the avatar gradient and border.
Project images remain full-color rather than template images. Working sessions use a static dot because native menus do
not reliably repaint animation frames. Finished sessions with a completion timestamp newer than their viewed timestamp
show a blue corner dot on the restored favicon, until the client acknowledges viewing that completion. Questions and
permission requests also add an attention dot. The menu-bar icon is badged whenever any listed session has one of these
notifications. State refreshes on the normal polling cycle; an open native menu keeps its current layout until reopened.
Footer actions reuse the app's SVG artwork,
with book and exit icons for Docs and Quit. SVG favicons are rasterized for native menus without opening a renderer window.

From the repository root:

```bash
bun run dev:tray     # Start with only the menu bar / tray icon
bun run dev:desktop  # Start the usual desktop window and the icon
bun run dev:tray:live # Use the installed opencode2 service for this desktop's tabs without replacing it
```

Or run `bun dev --tray` from `packages/desktop`. Packaged applications accept `--tray` as well. A tray-only launch respects
the saved opt-out and exits if the companion is disabled. Launch the desktop normally to enable it again under
**Settings → Preferences → Display → Menu bar / system tray**. The preference is shared between windows and persists
across launches. Development uses the dev app's settings, separate from the production app.

Manual checks:

- Start tray-only: the icon should appear without a desktop window.
- With no desktop windows open, the menu should say No active sessions. Open Settings or New Agent to restore a window.
- Verify that session rows appear above the actions and clicking one opens that exact session.
- Open and close session tabs: only open tabs should appear. Test multiple windows and a session open in both.
- Trigger a question or permission request: the session should move into Needs you on the next refresh.
- Choose New Agent or Settings: a window should open and perform the action after loading.
- Minimize that window and choose a session or Settings: it should restore and focus.
- Close all windows: the icon should remain available. Repeat New Agent and Settings.
- Open docs: the V2 documentation should open in your browser.
- Disable the tray in Settings: the icon should disappear immediately. Enable it again to restore it.
- Quit from the tray: the app and icon should exit. A subsequent launch should respect the saved preference.

Regular `dev:tray` uses the isolated desktop development server. `dev:tray:live` uses the client library to discover a
running service (no `opencode2` executable required), then attaches without electing or replacing it. These desktop-only
commands show desktop tabs; use `bun run dev` for the terminal companion. Selecting a TUI session updates the owning TUI,
but selecting a particular emulator tab/window among multiple Ghostty windows is not portable and remains host-dependent.

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

Production builds require a prebuilt V2 CLI distribution. The release workflow supplies the artifact from the same run:

```bash
OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST=/absolute/path/to/packages/cli/dist bun run build
OPENCODE_CHANNEL=prod bun run package
```

Set `OPENCODE_CLI_TARGET` when packaging for a different architecture. The CLI is placed outside `app.asar` in the
application's resources directory, and packaging fails if it is missing.

CLI preparation uses these channel rules:

| Channel                                | Without `OPENCODE_CLI_DIST`    | With `OPENCODE_CLI_DIST`                      |
| -------------------------------------- | ------------------------------ | --------------------------------------------- |
| `dev`, `local`, unset, or unrecognized | Download the dev CLI           | Download the dev CLI; ignore the distribution |
| `beta`                                 | Download the beta CLI          | Copy the supplied CLI; fail if it is missing  |
| `prod`, `latest`                       | Fail before changing resources | Copy the supplied CLI; fail if it is missing  |

`bun dev` is separate from packaging: it uses local renderer/server mode, the dev app identity, and the CLI source by
default. `bun dev --download-server <version>` instead downloads that CLI version for local development. Neither path
requires `OPENCODE_CLI_DIST` or runs the production prebuild.

## Startup benchmark

`bun run bench:startup` measures a **packaged** build from process spawn to the restored tab being ready and the
renderer going idle, so dev-server and bundling costs are not part of the numbers.

```bash
OPENCODE_CHANNEL=dev bun run build && bunx electron-builder --win --dir --config electron-builder.config.ts
bun run bench:startup -- --runs 5                                  # warm service (started once, reused by every launch)
bun run bench:startup -- --runs 5 --compare dist/other/OpenCode\ Dev.exe   # A/B: alternate launches of two builds
bun run bench:startup -- --service cold                            # each launch spawns the service
bun run bench:startup -- --fresh                                   # first launch after an install (profile wiped each time)
bun run bench:startup -- --profile-main --profile-renderer --trace # CPU profiles and a Chromium startup trace
bun run bench:startup -- --seed "%APPDATA%\ai.opencode.desktop.dev"   # restore tabs and drafts from an existing profile
```

The app runs in an isolated home (`%TEMP%\opencode-bench-startup`): its own `%APPDATA%`, XDG directories, OpenCode
database, config and service registration, with the developer's `OPENCODE_*` and `OTEL_*` environment stripped
(an inherited OTLP endpoint alone adds a network round trip to every CLI exit). It never attaches to or restarts the
developer's live service, and only ever kills the process tree it spawned. `--service cold` stops the service before
each launch so the desktop has to spawn it; the isolated config directory gives that service a private port. One
`--warmup` launch per build is discarded by default because the first launch of a new binary pays the antivirus scan.
`--compare` alternates two builds so machine drift affects both equally; they must bundle the same CLI or the desktop
restarts the service on the version mismatch.

Milestones (ms since spawn) come from the main log, the renderer's performance timeline and DOM readiness polled over
CDP. Node's bootstrap timing is read from the main process after each run over `--inspect` (nothing attaches until the
run is over): `processCreated` → `nodeStart` is Electron's native init, `nodeStart` → `nodeBootstrapped` is Node
itself, and `nodeBootstrapped` → `appStarting` is Electron's JavaScript init plus our main bundle up to its first
log line. Renderer idle is the start of the first 500 ms window with under 10 % main-thread task time that stays quiet
for `--settle-ms`; `rendererTaskMs` is the renderer's total main-thread task time until then. Raw samples are
written to `dist/bench-startup`.

A packaged beta or prod build registers itself as the `opencode://` handler when it starts, even from the bench; the
installed app takes the registration back on its next launch. Those channels run with `HTTPS_PROXY` pointed at a
closed port (`--offline` forces it for dev) so the updater's first check fails fast instead of reaching GitHub.
