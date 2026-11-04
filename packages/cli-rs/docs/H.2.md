# H.2: P-APP, whole-app parity

P-APP runs one scenario through the whole TypeScript TUI and the whole Rust TUI. Both get the same server
responses, events, and keys. P-APP then compares the screens cell by cell at each checkpoint, and compares the
requests each side sent (P-REQ). It needs no server process and no drive endpoint (plan 7.2).

```
parity/scenarios/<step>/<name>.app.ts   one scenario, written by hand
        │  bun test ./app/scenarios.test.tsx   (TS runner, createAppFixture)
        ▼
parity/fixtures/<step>/<name>.app.json   the recording: scenario, requests and responses
parity/fixtures/<step>/<name>/<checkpoint>.json   cells, in H.1's fixture format
        │  cargo test -p opencode-tui --test app   (Rust runner, TestApp over opencode_api::memory)
        ▼
pass, or a report of the differing cells and requests
```

TS is the source of truth. Fixtures are committed and regenerated with `bun run --cwd packages/cli-rs
fixtures`. Rust never writes them.

## A scenario

A scenario is one small file. E.2, E.6a, E.9a, E.11a, and later steps each add their own files under
`parity/scenarios/<step>/`. They never edit a shared list: both runners find scenarios by glob.

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
    { checkpoint: "open", until: "Why?", deviation: "V01-plain-transcript" },
    { keys: ["ctrl+x", "n"] },
    { event: { type: "session.text.delta", data: { /* … */ } } },
    { type: "hello" },
    { checkpoint: "home", until: "Ask anything", masks: [{ line: "Ask anything….*", reason: "random placeholder" }] },
  ],
})
```

- **`routes`** use H.3's route shape (`parity/lib/fake-server.ts`): `method` (default `GET`), `path` with
  `:name` segments, `status`, and `json`, `body`, or neither (204). They are matched before the TUI test
  defaults of `packages/tui/test/fixture/tui-client.ts`, which answer everything else the TS TUI reads at
  startup. The defaults answer `/api/session` with an empty list, so a scenario with sessions routes it.
- **`args`**: `sessionID` opens a session (TS `args.sessionID`, Rust `Route::Session`); `continue` is `-c`.
- **Steps** run in order:
  - `keys`: shortcuts in opentui-rust's syntax (`KeyEvent::from_shortcut`): `enter`, `escape`, `tab`,
    `backspace`, `space`, `up`, `down`, `left`, `right`, `pageup`, `pagedown`, a character, with `ctrl+`,
    `shift+`, `alt+`. TS sends them with `mockInput` in kitty mode.
  - `type`: text, one key press per character.
  - `event`: one `/api/event` event. TS emits it on `createEventStream`; Rust sends it on the in-memory event
    stream. The stream starts with `server.connected` on both sides, as the TS fixture does.
  - `checkpoint`: a named screen, compared cell by cell.
- **Checkpoint fields**:
  - `until`: text the TS frame must contain before the capture. Rust waits for it too, but at most 2 s, so a
    screen Rust does not draw yet still gets compared and reported.
  - `masks`: cells blanked on both sides before the comparison, each with a `reason`. A mask is a rectangle
    `{ x, y, width, height }` or a `line` regex, which blanks every match on every row. Masks are for
    nondeterministic text (the random prompt placeholder, durations, relative times). Plan 7.5: a mask over
    a whole widget needs a deviation file.
  - `deviation`: the name of `parity/deviations/<name>.md`. The checkpoint may then differ: the Rust
    runner prints the report and passes. Without a deviation file, a difference fails. A missing file
    fails. A checkpoint that now matches prints a note to remove its deviation.
- **`requests: { deviation }`** at the top level does the same for P-REQ.

Scenario data uses fixed IDs and times, so no ID or time normalizer is needed in cells. Helpers in
`parity/lib/app.ts` (`session`, `user`, `assistant`) build valid wire objects with fixed times.

## The recording

`parity/fixtures/<step>/<name>.app.json`, pretty JSON:

```json
{
  "scenario": "H.2/session-open",
  "width": 100, "height": 30,
  "directory": "/tmp/opencode/packages/tui",
  "config": { "animations": false },
  "args": { "sessionID": "ses_b" },
  "routes": [ … as in the scenario … ],
  "steps": [ … as in the scenario; each checkpoint gains "fixture": "H.2/session-open/open" … ],
  "requests": {
    "writes": [ { "method": "POST", "path": "…", "query": {…}, "body": … } ],
    "reads": [ { "method": "GET", "path": "/api/vcs", "query": {…}, "status": 200, "json": … } ]
  }
}
```

- `reads` holds every GET the TS TUI sent with the response it got, sorted by method, path, and query, with
  duplicates removed. The TS TUI starts many reads at once, so their order is not stable; sorting keeps two
  replays byte-identical. `writes` keeps the order in which they were sent.
- The event stream is not logged.
- `directory` is the location the TS fixture serves (`tui-client.ts`, `directory`). Rust gets it as
  `Deps.directory`.
- The one query value that depends on the machine, the `fs/list` startup probe of `process.cwd()`, is
  normalized to `<cwd>`.
- Each checkpoint's cells are written to `parity/fixtures/<step>/<name>/<checkpoint>.json`, H.1's format,
  with masked cells blanked as `" "` in style `#00000000 #00000000 0`.

## The TS runner

`parity/app/scenarios.test.tsx` makes one `bun test` case per scenario file. `PARITY_SCENARIO=<step>/<name>`
selects one. Each case:

1. starts `createAppFixture` (`packages/tui/test/fixture/app.ts`) at the scenario size, with the config and
   args. Its fetch override serves the routes, then a private `createFetch` for the defaults, and records each
   exchange. `/api/event` is left to the fixture's stream;
2. awaits `ready`, then runs the steps;
3. at a checkpoint, polls every 30 ms with a 5 s wall-clock deadline, until the frame contains `until` and
   three polls in a row read the same cells, not only the same characters. Highlighting changes colors after
   the text shows;
4. writes the cell files and the recording.

Replaying a scenario twice must give byte-identical files. That is the step's TS-against-TS proof.

## The in-memory transport

`opencode_api::memory::Memory` implements `Transport`:

- it serves a list of routes, each with a method, a path pattern, a query, a status, and a body. Routes are
  tried in order, so the scenario routes come before the recorded reads. A route without a query matches any
  query. A recorded read matches its exact query first, then by path alone;
- `/api/event` returns a `text/event-stream` body fed by an unbounded channel. Events are scenario data and
  few, so the channel cannot grow without limit. `Memory::emit(json)` sends one event. The stream starts with
  `server.connected`;
- it logs every request (method, path, decoded query, JSON body). A request no route answers gets a 404,
  and the log marks it `unmatched`;
- it counts requests in flight, so a test can wait until the client is idle.

It knows nothing of scenarios, so other tests can use it as a small fixture server.

## The Rust runner

`crates/tui/tests/app.rs`, one test, `scenarios`, which runs every recording under `parity/fixtures/*/`
(`PARITY_SCENARIO` selects one) and fails at the end with every failing scenario's report:

1. builds `Memory` from the recording's routes, then its reads;
2. mounts the TUI on `TestApp::new(width, height)` with `opencode_tui::mount(app, Deps { events: true,
   directory, config, route, continue_ })`, the T.1 hook;
3. runs the steps: `keys` with `TestApp::press`, `type` with `TestApp::type_text`, and `event` with
   `Memory::emit`;
4. at a checkpoint, waits until no request is in flight and two renders 25 ms apart are equal (and `until`
   shows, for up to 2 s), then compares with `opencode_parity::app::compare_checkpoint`;
5. compares P-REQ (`opencode_parity::app::compare_requests`):
   - writes: method, path, and JSON body, in order;
   - reads: every Rust read must be answered (`unmatched` fails with the request's name). TS reads that Rust
     does not send are listed, not failed: the Rust TUI is missing most features in MS1, and each feature
     step proves its own reads.

`opencode_parity::app` (in `crates/parity/src/app.rs`) holds the recording types, masks, and both
comparisons. It does not depend on the TUI, so the parity crate stays a leaf.

## Out of scope

- Mouse steps, resize steps, and time steps. A later step adds `mouse` and `resize` when it needs them.
  There is no time step: TS runs with `animations: false`, and Rust's clock is manual.
- File state (P-FILE). A scenario runs with no config or state roots on the Rust side (`roots: None`). The TS
  fixture uses a fresh temporary state directory.
