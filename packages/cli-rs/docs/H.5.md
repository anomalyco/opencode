# H.5: P-TUI, the simulation harness

P-TUI runs the TS server in simulation mode and drives the TS TUI and `opencode-rs` through the same steps over
their `OPENCODE_DRIVE` UI endpoints (H.4). The simulated provider answers every model call from a backend driver
in the harness. At each checkpoint the runner captures both screens with `ui.capture` and compares them cell by
cell with H.2's rules: the same cell format, the same masks, and the same deviation files. Writes to the server
are compared as H.2 compares them (P-REQ).

```sh
bun run --cwd packages/cli-rs parity:sim [--sides ts,rs] [parity/scenarios/<step>/<name>.sim.ts ...]
```

`--sides ts,ts` proves that a scenario is deterministic. The Rust binary is `target/debug/opencode-rs` (the runner
builds it) or `OPENCODE_RS_BIN`.

## One side of a run

Each side runs alone, one after the other, so the two clients never share a server or a database:

1. **Sandbox.** One temporary root per run (`parity/cli/client.ts` `sandbox`). Each side gets a fresh `home`
   (HOME and the XDG roots) and `tmp`; `work`, the working directory, is the same path for both sides, so paths on
   screen match. The environment starts empty. Nothing reads or writes the user's config, state, or service.
   `OPENCODE_TEST_HOME` is the sandbox home too: Bun's `os.homedir()` ignores HOME, and without it the server
   watched the user's skill folders.
2. **Server.** `opencode serve --port <private>` from source with `OPENCODE_SIMULATE=1`, `OPENCODE_DB=:memory:`,
   `OPENCODE_DRIVE=server`, and a drive manifest in the sandbox (`packages/simulation/src/manifest.ts`) whose
   backend endpoint is a private port. `OPENCODE_CONFIG_DIR` holds `opencode.jsonc` with the `simulation`
   provider (an OpenAI-compatible provider at the default OpenAI URL, which the simulated network answers),
   `model: "simulation/gpt-sim-model"`, `snapshots: false`, and the scenario's permission rules.
3. **Backend driver** (`parity/sim/backend.ts`). It connects to the backend endpoint, runs
   `simulation.handshake` (role `backend`) and `llm.attach`, and answers each `llm.request` notification with the
   scenario's next reply: `llm.chunk` with its items, then `llm.finish` with its reason. A request that offers no
   tools is the title request; it gets the title `Simulated session`, so the scripted replies stay in order.
   `report.json` lists every model call with the tool names it offered (the shell tool is `shell`, not `bash`).
4. **Recording proxy** (`parity/sim/proxy.ts`). The client talks to a proxy on a private port that forwards to
   the server, streams responses (the event stream included), and logs each request: method, path, decoded
   query, and JSON body.
5. **Client.** The TS CLI from source or `opencode-rs`, with `--server <proxy>`, `OPENCODE_DRIVE=<side>`,
   `OPENCODE_DRIVE_RENDERER=headless`, and its own manifest with the scenario's viewport. `cli.json` sets
   `experimental["new-designs"]`, `animations: false`, and `debug.devtools: false` (the TS CLI from source is the
   `local` channel, which shows the DevTools bar).
6. **Steps.** The runner sends the scenario's steps to the UI endpoint (`parity/sim/drive.ts`). At the end every
   process the side started is killed, also on failure and on exit.

## Scenarios

One file per scenario, `parity/scenarios/<step>/<name>.sim.ts`, with `export default defineSim({...})`
(`parity/sim/scenario.ts`):

- `width`, `height`: the viewport (default 100x30).
- `permissions`: rules appended to the allow-all rule, for example `{ action: "bash", resource: "*", effect: "ask" }`.
- `files`: files written under `work` before the server starts.
- `model`: the replies, in order, one per model call of the session. A reply is `{ items, finish }` with the
  protocol's items (`textDelta`, `reasoningDelta`, `toolCall`, ...).
- `steps`:
  - `{ type: "text" }`, `{ press: "escape", modifiers? }`, `{ enter: true }`, `{ arrow: "down" }`: keys.
  - `{ mouse: { action, x, y, button?, direction? } }`: the `ui.mouse` parameters. Rust has no `ui.focus`,
    `ui.click`, or `ui.state` (`parity/deviations/T14a-drive-capabilities.md`), so scenarios address the screen
    by coordinates.
  - `{ resize: [cols, rows] }`.
  - `{ until: "text" }`: wait until the screen shows the text.
  - `{ checkpoint, until?, masks?, deviation? }`: wait for `until`, then for three captures in a row with the
    same cells, then record and compare. `masks` and `deviation` mean what they mean in P-APP
    (`parity/lib/app.ts`).

## Comparison

- A capture (`Frontend.CapturedFrame`, spans with RGBA colors) becomes an H.1 cell fixture (`parity/lib/cells.ts`
  format). The captures carry no palette intent, so colors are plain `#rrggbbaa` on both sides.
- `applyMasks` from `parity/lib/app.ts` masks both sides, then the cells are compared one by one (symbol, fg, bg,
  attributes), as `opencode_parity::compare` does. The report lists the differing rows with markers and the first
  differing cells, in the H.1 report shape.
- A checkpoint passes when the cells are equal, or when it lists deviation files and all of them exist. A listed
  file that does not exist fails the checkpoint.
- Requests: writes (anything but GET and plugin `get` RPCs, H.2's `isRead`) must match in order by method, path,
  and body after the plan 7.5 normalizers (prefixed IDs, the sandbox root, ports). Reads that one side sent and the
  other did not are listed, not failed, as in H.2. Bodies are compared as JSON values (key order does not count),
  and epoch-millisecond times and other server-minted IDs (`sh_…`) are normalized, because the server is live.
- Files per run: `parity/fixtures/H.5/<name>/<checkpoint>.<side>.json` (cells after masks) and `.txt` (text), and
  `report.json`. With `--sides ts,ts` the second side is named `ts2`.

## Known TS defect

The TS endpoint never answers a `ui.matches` whose screen read meets a frame in flight (H.4's report:
`OutputBusy`, logged by the control server, no response). `parity/sim/drive.ts` resends a `ui.matches` that gets
no answer within 2 s, and a `ui.capture` after 5 s (both are reads). It is the only place with this workaround; H.4's
`drive.ts` uses the same client.

## Writing a scenario

- Wait for readiness with `until`, not with time. On home, wait for the model line (`Simulated Model`): the Rust TUI
  ignores Enter until its catalogs have loaded, and in TS the line appears at the same point.
- Find coordinates for `mouse` steps in the `.txt` files of a TS run (row and column from 0).
- On failure the runner prints both processes' stderr, the model calls, the requests, and the last screen, and keeps
  the sandbox (with the server log under `home/.local/share/opencode/log`).

## Proof

- TS against TS on the MS1 scenario: every checkpoint equal, writes equal.
- TS against Rust on `H.5/permission-reply`: open a new session from home, send a prompt, the simulated model
  streams text and one `shell` tool call, the client shows the permission request, the scenario clicks "Allow once",
  the model streams the final reply, and the final screens are compared.
