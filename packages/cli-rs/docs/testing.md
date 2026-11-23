# Testing

`opencode-native` is tested against the TypeScript client: both get the same input, and what they print, draw and
send is compared. The TypeScript client is the source of truth. An intended difference is a file in
`parity/deviations/` that states both behaviors and the reason; a scenario names the file where it lets cells differ,
and a difference without a file fails. Paths are relative to `packages/cli-rs`, and commands run there.

| Suite | Compares | Runs as |
| --- | --- | --- |
| Unit and integration | The Rust code alone | `cargo test` |
| P-ORACLE | A function's output with the TypeScript function's, over a corpus | `cargo test`, against committed fixtures |
| P-COMP | One widget's cells with the TypeScript component's | `cargo test`, against committed fixtures |
| P-APP | The whole TUI's screens and requests, over an in-memory server | `cargo test`, against committed recordings |
| P-FILE | Files one client wrote, read by the other | `cargo test`, which runs a TypeScript helper |
| P-CLI | Exit code, stdout, stderr and requests of one command | `bun run parity:cli` |
| P-PTY | Screens and OSC output under a pseudo-terminal | `bun run parity:pty` |
| P-TUI | The whole TUI's screens and requests, against a simulated server | `bun run parity:sim` |
| P-WIRE | ACP JSON-RPC transcripts | `bun run parity:acp` |

P-APP, P-CLI, P-PTY and P-TUI also compare requests: writes must match in order, and reads as a sorted set.

## Running

Run cargo through the package script, which installs OpenTUI's native library and runs where `.cargo/config.toml`
is:

```sh
bun run cargo fmt --check
bun run cargo clippy --all-targets -- -D warnings
bun run cargo test
bun run cargo test -p opencode-tui --test all tabs::      # one area of the TUI's tests
bun run cargo test -p opencode-tui --lib                  # its unit tests
```

`opencode-tui` and `opencode-ui` link the static OpenTUI library, so each has one integration test binary,
`tests/all/main.rs`, with a module for each area and shared helpers in `tests/all/support`. Add a module there, not a
new `tests/*.rs`.

The `parity:*` commands run the TypeScript client from source, so run `bun install` at the repository root first;
without it a run fails with `Cannot find module '@opentui/solid/preload'`. Each builds the debug binary unless
`OPENCODE_RS_BIN` names one.

```sh
bun run parity:cli [--sides ts,rs] [parity/scenarios/<group>/<name>.cli.ts ...]
bun run parity:pty [--sides ts,rs] [parity/scenarios/<group>/<name>.pty.ts ...]
bun run parity:sim [--sides ts,rs] [parity/scenarios/<group>/<name>.sim.ts ...]
bun run parity:acp [suite ...]
```

Without files a runner runs every scenario of its kind. `--sides ts,ts` runs the TypeScript client twice, which
shows whether a scenario is deterministic. Rust tests that run TypeScript helpers skip without Bun or `node_modules`;
`OPENCODE_RS_REQUIRE_TS=1` makes them fail instead.

| Command | Checks |
| --- | --- |
| `bun run check:drift` | Generated files and oracle fixtures still match their TypeScript sources |
| `bun run check:deny` | Licences, banned crates and sources of the dependencies (`deny.toml`) |
| `bun run check:advisories` | Security advisories of the dependencies |
| `bun run check:luau-types` | Every Luau plugin in the repository type-checks with `luau-analyze` |
| `bun run parity:machines` | The TypeScript reader of the plugin state machine |
| `sh script/check-windows.sh [x64\|arm64]` | The workspace compiles for Windows, and `script/lint-windows.sh` finds no path code that is wrong there |
| `sh script/check-target.sh <target>` | The workspace compiles for another target; nothing is linked or run |

## Scenarios and fixtures

A scenario is a file under `parity/scenarios/<group>/`, where a group is named for the area it covers. Its suffix
picks the suite: `.app.ts`, `.cli.ts`, `.pty.ts` or `.sim.ts`. Runners find scenarios by glob, so adding one edits no
list.

Committed fixtures are under `parity/fixtures/<group>/`, and only their writers write them, never a person or a Rust
test. `bun run fixtures` runs every P-ORACLE script, P-COMP script and P-APP scenario, in name order. Run outputs go
to `parity/out/` and `$TMPDIR/opencode-parity/`, which git ignores.

P-COMP, P-APP and P-TUI compare screens cell by cell: symbol, foreground, background and attributes. A cell fixture
is JSON with the size and style table on its first line, then one line per row with its text and its
`[style, cell count]` runs (`parity/lib/cells.ts` documents the format; `crates/parity` reads it):

```json
{"width":100,"height":30,"styles":["#eeeeeeff #0a0a0aff 0",…],"lines":[
["  ┃ text…",[[4,2],[5,1],[0,95]]],
…
]}
```

## P-ORACLE and P-COMP

A P-ORACLE script (`parity/oracle/<name>.ts`) runs a TypeScript function over a corpus and writes the results to
`parity/fixtures/` through `parity/lib/records.ts`, one record a line, so a re-record diffs one line for each changed
case. A Rust test applies the same inputs and compares. A script whose first line calls it a "helper" writes no
fixture; a Rust test runs it with arguments.

A P-COMP script (`parity/component/<name>.tsx`) renders one TypeScript component at a fixed size and theme and writes
its cells (`parity/lib/component.tsx`). The Rust test renders the matching widget at the same size and fails with a
list of the cells that differ:

```rust
let app = TestApp::new(60, 12);
// build the widget...
opencode_parity::assert_fixture(&app.render(), "U.3/alert");
```

## P-APP: the whole TUI in memory

P-APP runs one scenario through the whole TypeScript TUI and the whole Rust TUI, with the same server responses,
events and keys and no server process, and compares the screens at each checkpoint and the requests each side sent.

```text
parity/scenarios/<group>/<name>.app.ts            one scenario, written by hand
        │  bun test ./app/scenarios.test.tsx      (the TypeScript runner)
        ▼
parity/fixtures/<group>/<name>.app.json           the recording: scenario, requests and responses
parity/fixtures/<group>/<name>/<checkpoint>.json  cells
        │  cargo test -p opencode-tui --test all app::   (the Rust runner, over opencode_api::memory)
        ▼
pass, or a report of the differing cells and requests
```

```ts
// parity/scenarios/H.2/session-open.app.ts
import { defineApp, session, user, assistant } from "../../lib/app"

export default defineApp({
  width: 100, // default 100
  height: 30, // default 30
  config: {}, // cli.json `Info`; both sides add `animations: false`
  args: { sessionID: "ses_b" }, // or { continue: true }; default: home
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser") } },
    { path: "/api/session/ses_b/message", json: { data: [assistant("msg_2", "Done."), user("msg_1", "Why?")], cursor: {} } },
  ],
  steps: [
    { checkpoint: "open", until: "Why?", deviation: [{ file: "V03-markdown-widget", cells: 70 }] },
    { keys: ["ctrl+x", "n"] },
    { event: { type: "session.text.delta", data: { /* … */ } } },
    { type: "hello" },
    { checkpoint: "home", until: "Ask anything", masks: [{ line: "Ask anything….*", reason: "random placeholder" }] },
  ],
})
```

- **`routes`** have a `method` (default `GET`), a `path` with `:name` segments, a `status`, and `json`, `body`, or
  neither (204). The TUI test defaults of `packages/tui/test/fixture/tui-client.ts` answer the rest of what the
  TypeScript TUI reads at startup, including an empty `/api/session`, so a scenario with sessions routes it.
- **Steps** run in order (`parity/lib/app.ts` has them all): `keys` (shortcuts such as `ctrl+x`, or a character),
  `type` (one key press a character), `paste`, `click` and `rightClick` at `[x, y]`, `drag`, `event` (one
  `/api/event` event after the initial `server.connected`), `wait` (milliseconds), and `checkpoint`.
- **A checkpoint** waits for its `until` text in the TypeScript frame; Rust waits for it at most 2 s, so a screen
  Rust does not draw is still compared. `masks` blank cells on both sides, each with a `reason`: a rectangle
  `{ x, y, width, height }` or a `line` regex, for text that is not deterministic (the random placeholder, durations,
  relative times). A mask over a whole widget needs a deviation file. `deviation` lists `{ file, cells, styleOnly? }`:
  the file `parity/deviations/<file>.md` and how many cells it lets differ (with `styleOnly`, only in style). The
  allowances add up; a difference beyond them, or a missing file, fails, and a checkpoint that now matches prints a
  note to remove them. A top-level `requests: { deviation }` does the same for requests.

Scenario data uses fixed IDs and times; the helpers `session`, `user` and `assistant` build valid wire objects.

The recording holds the scenario and every request with its response. A read is a GET or a plugin RPC named `get`;
everything else is a write. `reads` are sorted and deduplicated, because the TypeScript TUI starts many at once;
`writes` keep their order. The event stream is not logged, and recording twice must give identical files.

The TypeScript runner (`parity/app/scenarios.test.tsx`, under `TZ=UTC`) mounts the TUI's app fixture, serves the
routes then the defaults, runs the steps, and at a checkpoint waits for `until` and three identical polls. The Rust
runner (`crates/tui/tests/all/app.rs`) is one test, `scenarios`, which runs every recording and reports every failing
one at the end. It serves the recording from `opencode_api::memory::Memory`, mounts the TUI on a `TestApp`, and at a
checkpoint waits until no request is in flight and two renders are equal. It then compares the cells, the writes
(method, path and JSON body, in order), and the reads: every Rust read must be in the recording, and a TypeScript read
Rust did not send is listed, not failed. `Memory` knows nothing of scenarios, so other tests use it as a small fixture
server: routes, `/api/event` fed by `Memory::emit`, a request log, and an in-flight count.

To add a scenario:

1. Write `parity/scenarios/<group>/<name>.app.ts`.
2. Record it twice; `git status` must show no change after the second run.

   ```sh
   PARITY_SCENARIO=<group>/<name> bun test --cwd parity ./app/scenarios.test.tsx
   ```

3. Replay it. On a difference the runner writes the Rust cells to
   `$TMPDIR/opencode-parity/<group>/<name>/<checkpoint>.json` to diff against the recording. `PARITY_VERBOSE=1`
   prints the full report of a checkpoint that passes within its deviations.

   ```sh
   PARITY_SCENARIO=<group>/<name> bun run cargo test -p opencode-tui --test all app::scenarios -- --nocapture
   ```

4. When a checkpoint matches, remove its deviation, and delete a deviation file no scenario names.

## P-CLI and P-PTY: one command

Both runners start the TypeScript CLI from source and `opencode-native` with the same arguments, each in a fresh
home with its own XDG roots and `TMPDIR`, without the caller's `OPENCODE_*` variables, and against its own fake
server: `--server <url>` is appended, or replaces a `$SERVER` argument. Neither touches the user's service. Records
go to `$TMPDIR/opencode-parity/{cli,pty}/<name>.<n>-<side>.json`. P-CLI compares the exit code, stdout, stderr and
requests:

```ts
// parity/scenarios/C.1/models.cli.ts
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["models"],
  server: { routes: [{ path: "/api/model", json: { location, data: [{ providerID: "openai", id: "gpt-5" }] } }] },
})
```

P-PTY runs the program in a pseudo-terminal of `cols` by `rows` (default 100 by 30) and feeds its output to OpenTUI's
embedded terminal, which also answers terminal queries. Each step writes `keys`, waits for `until` (OSC or screen
text, a string or a RegExp) and for `settle` ms without a change, and records the screen at `checkpoint`. It compares
the OSC log (titles, progress, clipboard, notifications), the masked checkpoints, the exit code (`exits: true`) and
the requests (`requests: true`):

```ts
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  server: { fallback: "tui" },
  steps: [
    { until: { osc: "OpenCode", screen: "Ask anything" }, settle: 500, checkpoint: "home" },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  masks: [{ pattern: /(?<=Ask anything… )".*"/, reason: "the placeholder is random" }],
  exits: true,
})
```

The fake server (`parity/lib/fake-server.ts`) takes `routes` of
`{ method = GET, path, status, json | body | events, headers }`, where `:name` matches one segment and `events` keeps
a stream open with one `data:` frame per event. `/api/info` reports version `local`, as both clients run from source
do; `version: "x"` changes it, and `false` removes it. `fallback: "tui"` answers the rest with the TUI test defaults,
`/api/event` included, and `emit(event)` pushes an event. An unrouted request gets 404 and logs as `(unmatched)`.
Both sides' output is normalized first: the server URL, sandbox root, prefixed IDs, ISO times, versions, durations and
`127.0.0.1` ports.

## P-TUI: the simulated server

P-TUI drives the TypeScript TUI and `opencode-native` through the same steps over their `OPENCODE_DRIVE` UI
endpoints, against the TypeScript server in simulation mode, and compares the screens at each checkpoint (with
P-APP's masks and deviations) and the writes. Each side runs alone, in its own sandbox (an empty environment, a fresh
home and `tmp`, the same working directory path), so the clients never share a server or database. Per side, the
runner starts `opencode serve` from source in simulation mode with an in-memory database, a backend driver
(`parity/sim/backend.ts`) that answers each model call with the scenario's next reply (and a fixed title to a request
with no tools), a recording proxy (`parity/sim/proxy.ts`), and the client with `--server <proxy>` and a headless
renderer. It sends the steps through `parity/sim/drive.ts`, and kills every process it started at the end.

A scenario is `parity/scenarios/<group>/<name>.sim.ts` with `export default defineSim({...})`
(`parity/sim/scenario.ts` has every field):

- `width`, `height`: the viewport (default 100 by 30);
- `permissions`: rules after the allow-all rule, such as `{ action: "bash", resource: "*", effect: "ask" }`;
- `files`: written under the working directory before the server starts;
- `model`: the replies, one per model call, each `{ items, finish }` with protocol items (`textDelta`,
  `reasoningDelta`, `toolCall`, …);
- `steps`: `{ type }`, `{ press, modifiers? }`, `{ enter: true }`, `{ arrow }`, `{ mouse }` at a cell,
  `{ resize: [cols, rows] }`, `{ until: "text" }`, `{ gone: "text" }`, and `{ checkpoint, until?, masks?, deviation? }`,
  which waits for three identical captures before comparing.

Wait with `until`, not with time; on home, wait for the model line, because the TUI ignores Enter until its catalogs
load. A checkpoint must not contain a toast: it goes on a 5 s wall clock, so a screen read that comes later catches it
on one side only, and waiting for it to appear can miss it the same way. P-APP's `E.19a/failed-toast` compares toasts,
on a still clock; a P-TUI scenario that would show one disables `opencode.notifications` (as `E.6b/messages` does).
The Rust endpoint has no `ui.focus`, `ui.click` or `ui.state`
([`T14a-drive-capabilities.md`](../parity/deviations/T14a-drive-capabilities.md)), so steps address cells: take
coordinates from the `.txt` files of a TypeScript run (row and column from 0). A run's files are in
`parity/out/<group>/<name>.sim/`: `<checkpoint>.<side>.json` and `.txt`, and `report.json` with every model call. On
failure the runner prints both sides' stderr, the model calls, the requests and the last screen, and keeps the
sandbox.

## P-WIRE: ACP

`bun run parity:acp` runs each ACP subprocess suite of `packages/cli/test/acp` once per agent through
`parity/acp/record.sh`, which records the JSON-RPC traffic. It fails when a test fails on either side or the
normalized transcripts differ. Transcripts are kept in `$TMPDIR/opencode-parity/acp/<suite>-<side>/`.

## The plugin state machine

`parity/machines/plugins.json` is a state machine of a plugin's life, read by both clients:
`crates/tui/tests/all/plugin_machines.rs`, and `parity/machines/plugins.test.tsx`, which drives the TypeScript TUI.
`bun run parity:machines` covers each edge once and the seeded walks; `bun run parity:machines:deep` adds every path
to the file's depth and the fault trials. The package has no `test` script, so the repository's `turbo test` does not
run this suite on every pull request that touches a package it depends on, such as `@opencode/tui`. The Rust side runs the plugin as its Luau twin, `parity/plugins/life/init.luau`, beside
the TypeScript `tui.tsx`.

## Generated files and drift

`bun run check:drift` (`script/drift.ts`) runs every generator in `script/gen/` and every fixture-writing oracle in
`parity/oracle/` on a clean tree, and lists each file that changed. A change means a TypeScript source moved: commit
the regenerated files, or fix the Rust side. `--all` adds the two generators whose output depends on more than the
checkout (`grammars.ts` downloads queries; `time.ts` depends on Bun's ICU data), and `--recordings` the slow P-COMP
and P-APP recordings.

## Windows, by hand

`crates/cli/tests/windows_smoke.rs` checks on a pseudoconsole that the TUI reaches home and that Ctrl+C leaves the
alternate screen. What a person sees in a real terminal needs this checklist, on Windows 11 24H2 or Windows 10 1809
or later, before a Windows build ships and when a release changes console code.

Unzip `opencode-native-<version>-x86_64-pc-windows-msvc.zip` (or `aarch64-pc-windows-msvc`) into a folder without
spaces, such as `C:\tools\opencode-native`, keeping `opencode-native.exe` beside the `opencode.exe` it starts. Run
`Unblock-File *` there from PowerShell, because the build is not signed, and check that `opencode-native --version`
prints the release. Install `nvim` (`winget install Neovim.Neovim`), and open a git repository with a few files.

Run every check in Windows Terminal (with PowerShell 7 and with `cmd.exe`) and in VS Code's integrated terminal. If
you can, run them in conhost too, which has known limits (no OSC 52 copy, weaker key reporting). mintty and Git Bash
without ConPTY are not supported, because the program's input there is a pipe. Record your machine, the Windows,
Windows Terminal, VS Code and `opencode-native` versions, and for each failure the check, the terminal, and what you
did, expected and got.

1. **Start and quit.** Run `opencode-native`, wait for home, press Ctrl+C. The logo and "Ask anything" show. It exits
   0 (`$LASTEXITCODE`, `%ERRORLEVEL%`) to a clean prompt with no stray escape text, and typing echoes normally.
2. **Keys.** In the prompt: type, Left, Right, Home, End, Ctrl+Left, Ctrl+Right, Backspace, Delete, Shift+Enter for a
   new line, Up and Down for history; Ctrl+P and Esc; Ctrl+X then M. Each key acts once: none repeats, is lost, prints
   escape text, or shows a key release as input.
3. **Keys in mini.** Repeat check 2 in `opencode-native mini`.
4. **Mouse.** Click a session in the list, wheel through a long transcript, click dialog buttons. Clicks hit what is
   under the pointer, and the wheel scrolls the view, not the terminal's scrollback.
5. **Selection and copy.** Drag over message text and paste into Notepad; also Ctrl+X then Y. The selection
   highlights while dragging and pastes in Notepad (in conhost, copy does nothing).
6. **Paste.** Paste several lines from Notepad with Ctrl+V and with the terminal's paste. The text arrives once, as
   one paste, unsent; three or more lines show as `[Pasted ~N lines]`.
7. **Image paste.** Copy a screenshot (Win+Shift+S) and press Ctrl+V. It attaches as `[Image 1]`.
8. **Resize.** Drag the edge, maximize, restore, change the font size (Ctrl+= and Ctrl+-). Each redraws cleanly.
9. **Close the window** while the TUI runs, then run `opencode-native` in a new tab. No `opencode-native.exe` is left
   in Task Manager, the new run starts normally, and the service still runs (`opencode-native service status`).
10. **Theme.** Start in a dark, then a light, color scheme, and switch themes from the palette. The TUI picks the
    matching theme without a slow start, and a switch redraws everything.
11. **Links.** Ctrl+click a URL in a message, and open a link from a dialog. The default browser opens it.
12. **Sounds.** Let a session finish while the window is unfocused. The attention sound plays (Windows Terminal may
    notify), and unknown OSC sequences print nothing.
13. **External editor.** With `EDITOR=nvim` (`$env:EDITOR = "nvim"`), type text, press Ctrl+X then E, edit, `:wq`.
    nvim takes the screen with a normal cursor and no mouse garbage, and the TUI comes back with the edited text.
14. **GUI editors.** Repeat check 13 with `EDITOR=notepad` and `EDITOR=code --wait`. The text comes back after the
    editor closes.
15. **CLI prompts.** Step through `opencode-native auth login` with arrows, Enter and Ctrl+C. Prompts redraw in place
    from the left edge, and Ctrl+C prints "Cancelled" and exits.
16. **Piped input.** `echo hi | opencode-native mini` reads `hi`, then takes keys from the keyboard.
