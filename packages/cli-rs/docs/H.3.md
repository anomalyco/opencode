# H.3: P-CLI and P-PTY

Both runners start the TS CLI from source (`bun packages/cli/src/index.ts`) and `opencode-rs`
(`target/debug/opencode-rs`, built by the runner, or `OPENCODE_RS_BIN`) with the same arguments. Each
run gets a fresh home with its own XDG roots and `TMPDIR`, an environment without the caller's
`OPENCODE_*` variables, `OPENCODE_CLI_NAME=opencode`, and its own fake server. `--server <url>` is
appended to the arguments, or replaces a `$SERVER` argument. Neither client touches the user's
service.

```sh
bun run --cwd packages/cli-rs parity:cli [--sides ts,rs] [parity/scenarios/<step>/<name>.cli.ts ...]
bun run --cwd packages/cli-rs parity:pty [--sides ts,rs] [parity/scenarios/<step>/<name>.pty.ts ...]
```

`--sides ts,ts` checks that a case is deterministic. Without files, a runner runs every scenario.
Records go to `$TMPDIR/opencode-parity/{cli,pty}/<name>.<n>-<side>.json`.

## A scenario

One file in `parity/scenarios/<step>/`. A case whose Rust command does not exist yet sets
`tsOnly: true`. The runner skips it when one side is `rs`.

```ts
// parity/scenarios/C.1/models.cli.ts
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["models"],
  server: { routes: [{ path: "/api/model", json: { location, data: [{ providerID: "openai", id: "gpt-5" }] } }] },
})
```

P-CLI compares the exit code, stdout, stderr, and the requests: writes in order, reads as a sorted set
(P-REQ).

```ts
// parity/scenarios/E.1/title.pty.ts
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

P-PTY runs the program under a PTY of `cols` x `rows` (default 100x30). It feeds the output to
OpenTUI's `EmbeddedTerminalRenderable`, which also answers the program's terminal queries. Each step
writes `keys`, then waits for `until` (an OSC sequence or screen text, a string or a RegExp) and for
`settle` ms without a screen change, then records the screen at `checkpoint`. P-PTY compares the OSC log
(kinds `title`, `progress`, `clipboard`, `notify`; set `osc` to change them), the checkpoints after masks,
the exit code (`exits: true`), and the requests (`requests: true`).

## The fake server (`parity/lib/fake-server.ts`)

- `routes`: `{ method = GET, path, status, json | body | events, headers }`. `:name` in `path` matches
  one segment. `events` keeps an event stream open with one `data:` frame per event.
- `/api/info` reports version `local`, the version both clients have when run from source. Use
  `version: "x"` for another version, or `false` to take it out of the defaults.
- `fallback: "tui"` answers the remaining requests with the TUI test defaults of
  `packages/tui/test/fixture/tui-client.ts`, including `/api/event`. `emit(event)` pushes an event.
- Every request is logged. A request without a route returns 404 and appears as `(unmatched)` in the
  request log.

Normalizers (plan 7.5): the server URL, the sandbox root, prefixed IDs, ISO times, versions,
durations, and `127.0.0.1` ports.
