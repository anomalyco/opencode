# Testing

`opencode-native` is tested against the TypeScript client: the same input goes to both, and what they print, draw
and send is compared. This document describes the suites, how to run them, and how to add a case. Paths are relative
to `packages/cli-rs`, and commands run from that directory.

## The suites

| Suite | Compares | Runs as |
| --- | --- | --- |
| Unit and integration tests | The Rust code alone | `cargo test` |
| P-ORACLE | A function's output with the TypeScript function's, over a corpus | `cargo test`, against committed fixtures |
| P-COMP | One widget's cells with the TypeScript component's | `cargo test`, against committed fixtures |
| P-APP | The whole TUI's screens and requests, over an in-memory server | `cargo test`, against committed recordings |
| P-FILE | Files one client wrote, read by the other | `cargo test`, which runs a TypeScript helper |
| P-CLI | Exit code, stdout, stderr and requests of one command | `bun run parity:cli` |
| P-PTY | Screens and OSC output under a pseudo-terminal | `bun run parity:pty` |
| P-TUI | The whole TUI's screens and requests, against a simulated server | `bun run parity:sim` |
| P-WIRE | ACP JSON-RPC transcripts | `bun run parity:acp` |

P-REQ is the comparison of requests, which P-APP, P-CLI, P-PTY and P-TUI share: writes must match in order, and
reads are compared as a sorted set.

The TypeScript client is the source of truth. A difference that is intended is a file in `parity/deviations/`, which
states the TypeScript behavior, the Rust behavior and the reason. A scenario names the file where it allows cells to
differ, and a difference without a file fails.

## Running

Run cargo through the package script, which installs OpenTUI's native library first and runs in this directory, where
`.cargo/config.toml` is:

```sh
bun run cargo fmt --check
bun run cargo clippy --all-targets -- -D warnings
bun run cargo test
bun run cargo test -p opencode-tui --test all tabs::      # one area of the TUI's tests
bun run cargo test -p opencode-tui --lib                  # its unit tests
```

The integration tests of `opencode-tui` and `opencode-ui` link the static OpenTUI library, so each crate has one test
binary, `tests/all/main.rs`, with one module for each area and the shared helpers under `tests/all/support`. A new
test file is a module there, not a new `tests/*.rs`.

The four `parity:*` commands run the TypeScript client from source, so run `bun install` at the repository root once
first. Each builds the debug binary, unless `OPENCODE_RS_BIN` names one.

```sh
bun run parity:cli [--sides ts,rs] [parity/scenarios/<group>/<name>.cli.ts ...]
bun run parity:pty [--sides ts,rs] [parity/scenarios/<group>/<name>.pty.ts ...]
bun run parity:sim [--sides ts,rs] [parity/scenarios/<group>/<name>.sim.ts ...]
bun run parity:acp [suite ...]
```

Without files, a runner runs every scenario of its kind. `--sides ts,ts` runs the TypeScript client twice, which
shows whether a scenario is deterministic.

Some Rust tests run TypeScript helpers and skip without Bun or `node_modules`. `OPENCODE_RS_REQUIRE_TS=1` makes them
fail instead.

Other checks:

| Command | Checks |
| --- | --- |
| `bun run check:drift` | Generated files and oracle fixtures still match the TypeScript they came from |
| `bun run check:deny` | Licences, banned crates and sources of the dependencies (`deny.toml`) |
| `bun run check:advisories` | Security advisories of the dependencies |
| `bun run check:luau-types` | Every Luau plugin in the repository type-checks with `luau-analyze` |
| `bun run test` | The TypeScript reader of the plugin state machine |
| `sh script/check-windows.sh [x64\|arm64]` | The workspace compiles for Windows, and `script/lint-windows.sh` finds no path code that is wrong there |
| `sh script/check-target.sh <target>` | The workspace compiles for another target; nothing is linked or run |

## Scenarios and fixtures

A scenario is one file under `parity/scenarios/<group>/`. Its suffix says which suite runs it: `.app.ts`, `.cli.ts`,
`.pty.ts` or `.sim.ts`. A group is a directory named for the area it covers. Runners find scenarios by glob, so
adding one edits no list.

Committed fixtures are under `parity/fixtures/<group>/`. Only their writers write them, never a person and never a
Rust test:

```sh
bun run fixtures          # every P-ORACLE script, P-COMP script and P-APP scenario, in name order
```

Run outputs go to `parity/out/` and `$TMPDIR/opencode-parity/`, which git ignores.

### Cell fixtures

P-COMP, P-APP and P-TUI compare screens cell by cell: symbol, foreground, background and attributes. A cell fixture
is JSON with the size and the style table on its first line, then one line for each screen row with the row's text
and its `[style, cell count]` runs. `parity/lib/cells.ts` documents the format, and `crates/parity` reads and
compares it.

```json
{"width":100,"height":30,"styles":["#eeeeeeff #0a0a0aff 0",…],"lines":[
["  ┃ text…",[[4,2],[5,1],[0,95]]],
…
]}
```

## P-ORACLE and P-COMP

A P-ORACLE script (`parity/oracle/<name>.ts`) runs a TypeScript function over a corpus and writes the results to
`parity/fixtures/`. A Rust test applies the same inputs and compares. Oracle fixtures are written through
`parity/lib/records.ts`, one record on a line, so a re-record diffs one line for each changed case. A script whose
first line calls it a "helper" writes no fixture: a Rust test runs it with arguments.

A P-COMP script (`parity/component/<name>.tsx`) renders one TypeScript component at a fixed size and theme and writes
its cells (`parity/lib/component.tsx`). The Rust test renders the matching widget in a `TestApp` at the same size and
calls `opencode_parity::assert_fixture`, which fails with a readable list of the cells that differ:

```rust
let app = TestApp::new(60, 12);
// build the widget...
opencode_parity::assert_fixture(&app.render(), "U.3/alert");
```

## P-APP: the whole TUI in memory

P-APP runs one scenario through the whole TypeScript TUI and the whole Rust TUI. Both get the same server responses,
events and keys. It compares the screens at each checkpoint and the requests each side sent. It needs no server
process.

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

### A scenario

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
  neither (204). They are matched before the TUI test defaults of `packages/tui/test/fixture/tui-client.ts`, which
  answer everything else the TypeScript TUI reads at startup. The defaults answer `/api/session` with an empty list,
  so a scenario with sessions routes it.
- **`args`**: `sessionID` opens a session, and `continue` is `-c`.
- **Steps** run in order. `parity/lib/app.ts` has the full list. The common ones:
  - `keys`: shortcuts such as `enter`, `escape`, `ctrl+x`, `shift+tab`, or a character;
  - `type`: text, one key press for each character; `paste`: a bracketed paste;
  - `click`, `rightClick`: `[x, y]`, a press and release at a cell; `drag`: from one cell to another;
  - `event`: one `/api/event` event. The stream starts with `server.connected` on both sides;
  - `wait`: milliseconds that pass with no input;
  - `checkpoint`: a named screen, compared cell by cell.
- **Checkpoint fields:**
  - `until`: text the TypeScript frame must contain before the capture. Rust waits for it too, but at most 2 s, so a
    screen Rust does not draw still gets compared and reported.
  - `masks`: cells blanked on both sides before the comparison, each with a `reason`. A mask is a rectangle
    `{ x, y, width, height }` or a `line` regex, which blanks every match on every row. Masks are for text that is
    not deterministic: the random prompt placeholder, durations, relative times. A mask over a whole widget needs a
    deviation file.
  - `deviation`: a list of `{ file, cells, styleOnly? }`: the file `parity/deviations/<file>.md` and the number of
    cells it allows to differ. With `styleOnly`, those cells must keep their symbols. The entries add up, and the
    checkpoint passes when it differs in no more cells than they allow. A difference beyond them fails, and so does
    a missing file. A checkpoint that now matches prints a note to remove its deviations.
- **`requests: { deviation }`** at the top level does the same for the request comparison.

Scenario data uses fixed IDs and times. The helpers in `parity/lib/app.ts` (`session`, `user`, `assistant`) build
valid wire objects with fixed times.

### The recording

`parity/fixtures/<group>/<name>.app.json` holds the scenario and every request with the response it got.

- A read is a GET, or a plugin RPC named `get`. Everything else is a write.
- `reads` are sorted by method, path and query, with duplicates removed: the TypeScript TUI starts many reads at
  once, so their order is not stable. `writes` keep the order in which they were sent.
- The event stream is not logged.
- Replaying a scenario twice must give byte-identical files.

### The runners

The TypeScript runner (`parity/app/scenarios.test.tsx`) makes one `bun test` case for each scenario file. It mounts
the TUI's app fixture at the scenario's size, serves the routes and then the defaults, runs the steps, and at a
checkpoint polls until the frame contains `until` and three polls in a row read the same cells. The process runs with
`TZ=UTC`.

The Rust runner (`crates/tui/tests/all/app.rs`) is one test, `scenarios`, which runs every recording and fails at the
end with every failing scenario's report. It serves the recording's routes, then its reads and writes, from
`opencode_api::memory::Memory`; mounts the TUI on a `TestApp`; runs the steps; and at a checkpoint waits until no
request is in flight and two renders are equal. Then it compares:

- cells, with `opencode_parity::app::compare_checkpoint`;
- writes: method, path and JSON body, in order;
- reads: every Rust read must be answered by the recording. A request no route answers fails with its name. Reads
  the TypeScript TUI sent and Rust did not are listed, not failed.

`Memory` knows nothing of scenarios, so other tests use it as a small fixture server: it serves a list of routes,
feeds `/api/event` from `Memory::emit`, logs every request, and counts requests in flight.

### Adding a scenario

1. Write `parity/scenarios/<group>/<name>.app.ts`.
2. Record it, twice. `git status` must show no change after the second run.

   ```sh
   PARITY_SCENARIO=<group>/<name> bun test --cwd parity ./app/scenarios.test.tsx
   ```

3. Replay it. On a difference, the runner writes the Rust cells to
   `$TMPDIR/opencode-parity/<group>/<name>/<checkpoint>.json` for a diff against the recorded file.
   `PARITY_VERBOSE=1` prints the full report of a checkpoint that passes within its deviations.

   ```sh
   PARITY_SCENARIO=<group>/<name> bun run cargo test -p opencode-tui --test all app::scenarios -- --nocapture
   ```

4. When a change makes a checkpoint match, remove the deviation from the scenario. When no scenario names a
   deviation file any more, delete the file.

## P-CLI and P-PTY: one command

Both runners start the TypeScript CLI from source and `opencode-native` with the same arguments. Each run gets a
fresh home with its own XDG roots and `TMPDIR`, an environment without the caller's `OPENCODE_*` variables, and its
own fake server. `--server <url>` is appended to the arguments, or replaces a `$SERVER` argument. Neither client
touches the user's service. Records go to `$TMPDIR/opencode-parity/{cli,pty}/<name>.<n>-<side>.json`.

```ts
// parity/scenarios/C.1/models.cli.ts
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["models"],
  server: { routes: [{ path: "/api/model", json: { location, data: [{ providerID: "openai", id: "gpt-5" }] } }] },
})
```

P-CLI compares the exit code, stdout, stderr and the requests.

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

P-PTY runs the program under a pseudo-terminal of `cols` by `rows` (default 100 by 30). It feeds the output to
OpenTUI's embedded terminal, which also answers the program's terminal queries. Each step writes `keys`, waits for
`until` (an OSC sequence or screen text, a string or a RegExp) and for `settle` ms without a screen change, then
records the screen at `checkpoint`. P-PTY compares the OSC log (titles, progress, clipboard, notifications), the
checkpoints after masks, the exit code (`exits: true`) and the requests (`requests: true`).

The fake server (`parity/lib/fake-server.ts`):

- `routes`: `{ method = GET, path, status, json | body | events, headers }`. `:name` in `path` matches one segment.
  `events` keeps an event stream open with one `data:` frame for each event.
- `/api/info` reports version `local`, the version both clients have when run from source. `version: "x"` gives
  another version, and `false` takes it out of the defaults.
- `fallback: "tui"` answers the remaining requests with the TUI test defaults, `/api/event` included. `emit(event)`
  pushes an event.
- Every request is logged. A request without a route returns 404 and appears as `(unmatched)` in the request log.

Before the comparison, both sides' output is normalized: the server URL, the sandbox root, prefixed IDs, ISO times,
versions, durations and `127.0.0.1` ports.

## P-TUI: the simulated server

P-TUI runs the TypeScript server in simulation mode and drives the TypeScript TUI and `opencode-native` through the
same steps over their `OPENCODE_DRIVE` UI endpoints. A backend driver in the harness answers every model call. At
each checkpoint the runner captures both screens and compares them cell by cell, with the same masks and deviation
files as P-APP. Writes to the server are compared too.

Each side runs alone, one after the other, so the two clients never share a server or a database:

1. **Sandbox.** One temporary root for each run. Each side gets a fresh home and `tmp`. The working directory is the
   same path for both sides, so paths on screen match. The environment starts empty.
2. **Server.** `opencode serve` from source, in simulation mode, with an in-memory database and a config that holds
   the `simulation` provider and the scenario's permission rules.
3. **Backend driver** (`parity/sim/backend.ts`). It answers each model request with the scenario's next reply. A
   request that offers no tools is the title request, and gets a fixed title, so the scripted replies stay in order.
4. **Recording proxy** (`parity/sim/proxy.ts`). The client talks to a proxy that forwards to the server and logs each
   request.
5. **Client.** The TypeScript CLI from source or `opencode-native`, with `--server <proxy>`, a headless renderer and
   the scenario's viewport.
6. **Steps.** The runner sends the scenario's steps to the UI endpoint (`parity/sim/drive.ts`). At the end every
   process the side started is killed, also on failure.

A scenario is `parity/scenarios/<group>/<name>.sim.ts`, with `export default defineSim({...})`.
`parity/sim/scenario.ts` has every field. The main ones:

- `width`, `height`: the viewport (default 100 by 30).
- `permissions`: rules after the allow-all rule, such as `{ action: "bash", resource: "*", effect: "ask" }`.
- `files`: files written under the working directory before the server starts.
- `model`: the replies, in order, one for each model call of the session. A reply is `{ items, finish }` with the
  protocol's items (`textDelta`, `reasoningDelta`, `toolCall`, …).
- `steps`: `{ type }`, `{ press, modifiers? }`, `{ enter: true }`, `{ arrow }` for keys; `{ mouse }` for a mouse
  event at a cell; `{ resize: [cols, rows] }`; `{ until: "text" }`, which waits until the screen shows the text; and
  `{ checkpoint, until?, masks?, deviation? }`, which waits for `until`, then for three captures in a row with the
  same cells, then records and compares.

Writing a scenario:

- Wait for readiness with `until`, not with time. On home, wait for the model line: the TUI ignores Enter until its
  catalogs have loaded.
- The Rust endpoint has no `ui.focus`, `ui.click` or `ui.state`
  ([`parity/deviations/T14a-drive-capabilities.md`](../parity/deviations/T14a-drive-capabilities.md)), so scenarios
  address the screen by cells. Find coordinates for `mouse` steps in the `.txt` files of a TypeScript run (row and
  column from 0).
- Files of a run are in `parity/out/<group>/<name>.sim/`: `<checkpoint>.<side>.json` (cells after masks) and `.txt`
  (text), and `report.json`, which lists every model call.
- On failure the runner prints both processes' stderr, the model calls, the requests and the last screen, and keeps
  the sandbox.

## P-WIRE: ACP

`bun run parity:acp` runs each ACP subprocess suite of `packages/cli/test/acp` twice, once for each agent, through
`parity/acp/record.sh`, which records every agent's JSON-RPC traffic. It fails when a test fails on either side or
when the normalized transcripts differ. The transcripts are kept in `$TMPDIR/opencode-parity/acp/<suite>-<side>/`.

## The plugin state machine

`parity/machines/plugins.json` is a state machine of a plugin's life, with a reader in each client. The Rust reader
is `crates/tui/tests/all/plugin_machines.rs`. The TypeScript one, `parity/machines/plugins.test.tsx`, drives the
TypeScript TUI and builds no binary: `bun run test` covers each edge of the machine once and the seeded walks, and
`bun run parity:machines` adds every path to the file's depth and the fault trials.

The plugin contract has a suite of its own, the conformance transcripts
([`plugin-abi.md`](plugin-abi.md#conformance)).

## Generated files and drift

`bun run check:drift` (`script/drift.ts`) runs every generator in `script/gen/` and every fixture-writing oracle in
`parity/oracle/`, then lists each file whose content changed. Run it on a clean tree. A change means a TypeScript
source moved: commit the regenerated files, or fix the Rust side if the TypeScript change was intended.

Two generators are left out by default, because their output is not a function of the checkout alone:
`script/gen/grammars.ts` downloads queries, and `script/gen/time.ts` depends on the ICU data of the running Bun.
`--all` adds them. `--recordings` adds the P-COMP and P-APP recordings, which are slow.
