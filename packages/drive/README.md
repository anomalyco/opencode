# opencode-drive

This project gives your agents control over OpenCode:

- Run it during development and let your agents see and poke at the running instance
- Allow your agents to run it in headless mode and drive it to test things

## Requirements

OpenCode Drive requires [Bun](https://bun.sh/) 1.3.14 or newer. MP4 recording export also requires `ffmpeg` on `PATH`.

Install dependencies with:

```sh
bun install
```

## Skill

```sh
npx skills add anomalyco/opencode --agent opencode --skill opencode-drive
```

## Effect programs

The primary way to automate OpenCode is a default-exported, fully provided
Effect. Drive type-checks the module contract, compiles the script and its local
imports against the launching Drive toolchain, then validates and runs the
export in an isolated Bun process:

```ts
// drive.ts
import { OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(({ ui }) =>
  ui.screenshot("home"),
)
```

```sh
opencode-drive run ./drive.ts
```

`run` accepts exactly one module path. It rejects `--command.*` flags, other
command flags, and application arguments after `--`. Backend and UI behavior
belongs in the Effect program.

`OpenCodeDriver.use` is the safe default. It owns the scope, observes backend
failure, settles queued LLM work, closes every TUI, and exports recordings
whether the program succeeds or fails:

```ts
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(
  {
    project: {
      git: true,
      files: { "src/value.ts": "export const value = 1\n" },
    },
  },
  ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* llm.queue(Llm.text("The value is 1."))
      yield* ui.submit("Read src/value.ts")
      yield* ui.waitFor("The value is 1.")
    }),
)
```

Use `OpenCodeDriver.useReport` when the program also needs structured evidence.
It returns the program value plus a schema-validated report containing branded
artifact and recording paths, retention, and the negotiated or legacy
compatibility of every simulation endpoint:

```ts
const result = yield* OpenCodeDriver.useReport(options, program)
yield* Effect.log(result.report)
```

Drive prefers `simulation.handshake` and explicitly records legacy fallback.
Require negotiation when protocol skew must fail before the program runs:

```ts
OpenCodeDriver.use({
  opencode: { compatibility: "required" },
}, program)
```

Additional TUIs share the same server and LLM controller:

```ts
import { Effect } from "effect"
import { OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use((oc) =>
  Effect.gen(function* () {
    const secondary = yield* oc.tuis.launch({
      viewport: { cols: 120, rows: 40 },
    })
    yield* oc.ui.screenshot("primary")
    yield* secondary.ui.screenshot("secondary")
  }),
)
```

The generated OpenCode SDK client is exposed as `opencode`; launched frontend
processes are `tui` and `tuis`. This keeps SDK calls distinct from terminal UI
control:

```ts
const health = yield* opencode.health.get()
const frame = yield* tui.ui.capture()
```

Enable recording per TUI. Settlement finishes each timeline and exports its
video automatically:

```ts
import { Effect } from "effect"
import { OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(
  { tui: { recording: true } },
  (oc) =>
    Effect.gen(function* () {
      yield* oc.ui.screenshot("recorded-home")
      yield* Effect.log(
        `recording will be exported to ${oc.tui.recording?.path}`,
      )
    }),
)
```

Settlement errors are program failures. For example, output after a terminal
LLM event fails the run while `use` still closes TUIs and attempts recording
export:

```ts
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(({ ui, llm }) =>
  Effect.gen(function* () {
    yield* llm.queue(Llm.finish(), Llm.text("too late"))
    yield* ui.submit("trigger a response")
  }),
)
```

Use `OpenCodeDriver.make` only when the program needs explicit terminal
settlement. It requires a scope, and `driver.settle()` must run before leaving
that scope:

```ts
import { Effect } from "effect"
import { OpenCodeDriver } from "opencode-drive"

export default Effect.scoped(
  Effect.gen(function* () {
    const driver = yield* OpenCodeDriver.make()
    yield* driver.ui.screenshot("home")
    yield* driver.settle()
  }),
)
```

Use `opencode-drive check ./drive.ts` and `start --script` for the Effect-native
`defineScript` workflow described below.

## OpenCode development

Run this:

```sh
OPENCODE_DRIVE=1 bun run dev
```

If you installed the skill file, OpenCode will be able to see and interact with the running instance.

## Using with agents

Install the skill file above and ask the agent to test various flows with the app. Start with `--record` when you want a video; `opencode-drive stop` then exports the complete session and prints its path.

Screenshots and videos are written beneath `<system temp>/opencode-drive/output/<run-id>/<generation-id>`, so named outputs cannot overwrite media from earlier runs or restarts. Set `OPENCODE_DRIVE_MEDIA_DIR` to use a different media root.

Captured frames use the official full Commit Mono v1.143 faces at 16px with bundled Noto Symbols, Symbols 2, and Math fallbacks in a fixed 10x20 cell grid. Set `OPENCODE_DRIVE_FONT` to a comma-separated list of font files (for example regular, bold, italic, and bold-italic faces) to use a different primary capture font without changing the symbol fallback or cell geometry.

## UI development

If you are doing UI development in OpenCode, you might want to run it in a simulated mode. This allows `opencode-drive` to drive it and always put it into a state that you want to see.

Run it in visible mode:

```sh
opencode-drive start --visible --dev ~/projects/opencode
```

Initialize first when you need to customize the isolated environment before OpenCode starts:

```sh
artifacts=$(opencode-drive init --name demo)
cp -R ./fixtures/home/. "$artifacts/"
cp -R ./fixtures/project/. "$artifacts/files/"
opencode-drive start --name demo --visible --dev ~/projects/opencode
```

`start` reuses the prepared artifacts for that name. If `init` was not run, `start` initializes them automatically.

Drive uses an in-memory OpenCode database by default. Set
`OPENCODE_DRIVE_DB` when a test restarts the OpenCode service and needs sessions
to survive the replacement process. Relative paths resolve inside the isolated
run's OpenCode data directory:

```sh
OPENCODE_DRIVE_DB=restart.sqlite \
  opencode-drive start --name restart-demo --script ./restart.ts
```

Remove artifact directories left by sessions that are no longer active:

```sh
opencode-drive prune
```

Prune one inactive instance's artifacts by instance name, or force removal of all artifact directories:

```sh
opencode-drive prune --name demo
opencode-drive prune --force
```

While developing, you can run `opencode-drive restart` to restart only the UI (the server will persist as a separate process). Do this with agents, and they will always restart and get the UI where you want it to be automatically.

View the [skills file](https://github.com/anomalyco/opencode/blob/v2/.opencode/skills/opencode-drive/SKILL.md) for more details about the CLI.

## Effect script API

Scripted runs use one fully typed, Effect-only definition. `setup` and `run`
return Effects; Promise callbacks are not part of the API:

```sh
opencode-drive script init ./drive.ts
```

This creates a canonical starter without overwriting an existing file. The
generated script is ready for `opencode-drive check ./drive.ts` and
`start --script ./drive.ts`.

```ts
import { defineScript, Effect, Llm } from "opencode-drive"

export default defineScript({
  config: {
    autoupdate: false,
  },
  tuiConfig: {
    theme: "system",
  },
  project: {
    git: true,
    files: {
      "src/example.ts": "export const value = 1\n",
    },
  },
  setup: ({ config, tuiConfig }) =>
    Effect.sync(() => {
      config.username = "Drive"
      tuiConfig.scroll_speed = 1
    }),
  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* ui.submit("Read src/example.ts")
      yield* llm.send(Llm.text("The value is 1."))
      yield* ui.waitFor("The value is 1.")
    }),
})
```

`project.files` seeds the isolated project before `setup` runs. With
`project.git: true`, Drive creates a fresh repository and commits the complete
pre-launch state, including files written in `setup`. A prepared repository is
never replaced; omit `project.git` when an `init` step supplies Git history.
Declared `config` and `tuiConfig` values are deeply merged over fixture
`.opencode/opencode.jsonc` and `.opencode/tui.jsonc` files. Arrays replace
instead of merging, and mutations made in `setup` take final precedence.

Attach arbitrary provider-backed tools at runtime with their JSON schemas, then
take and settle native OpenCode invocations by model call ID. `attach` replaces
the complete dynamic set atomically; it does not affect the built-in adapters
configured through the driver or script `tools` option.

```ts
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(({ tools, llm, ui }) =>
  Effect.gen(function* () {
    yield* tools.attach({
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          outputSchema: {
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
          },
          options: { codemode: false },
        },
      ],
    })
    yield* llm.queue(
      Llm.toolCall({
        index: 0,
        id: "call_lookup",
        name: "lookup",
        input: { query: "meaning" },
      }),
      Llm.finish("tool-calls"),
    )
    yield* ui.submit("Look up the meaning")

    const lookup = yield* tools.take("call_lookup")
    yield* lookup.progress({
      structured: { phase: "searching" },
      content: [{ type: "text", text: "Searching" }],
    })
    yield* lookup.finish({
      structured: { answer: 42 },
      content: [{ type: "text", text: "42" }],
    })
  }),
)
```

Drive owns progress sequence numbers and retries uncertain operations without
rerunning a claimed call. `awaitCancelled()` completes when OpenCode interrupts
the native invocation before `finish` or `fail`. Dynamic registrations survive
the tool-only controller reconnecting; an intentional server generation change
cancels unresolved calls and reapplies the desired set after launch.

Declare which built-in tools Drive should intercept with `tools`, then control
their invocations inside `run`. Each tool controller accepts calls in arrival
order or by the stable call ID chosen in `Llm.toolCall`:

```ts
import { Effect } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  tools: ["shell"],
  run: ({ ui, llm, tools }) =>
    Effect.gen(function* () {
      const shells = yield* tools.control("shell")
      yield* llm.queue(
        Llm.toolCall({
          index: 0,
          id: "call_shell",
          name: "shell",
          input: { command: "deploy production" },
        }),
        Llm.finish("tool-calls"),
      )
      yield* ui.submit("Deploy production")
      const shell = yield* shells.take("call_shell")
      yield* shell.progress(`Running: ${shell.input.command}...\n`)
      yield* shell.succeed({ output: "Controlled output\n", exit: 0 })
    }),
})
```

Use `calls.take(id)` to coordinate known parallel calls independently, or
`calls.take()` to accept the next unclaimed invocation. A controlled call can
emit progress and then succeed or fail exactly once. `awaitInterrupted()`
observes OpenCode interruption or transport disconnection. Drive interrupts
all unresolved calls when it shuts down.

The original `tools(registry)` callback remains available for fixed handlers
that do not need orchestration from `run`. Foreground handler Effects are
interrupted when OpenCode interrupts the session, the transport disconnects,
or Drive shuts down. Detached background shell handlers continue after their
launch response and are interrupted when Drive shuts down.

Only declared or registered tools are replaced. Unhandled tools continue to
use OpenCode's real implementations. Each `progress` value replaces the
visible tool output; send accumulated output when earlier lines should remain
visible.
Supported adapters are `shell`, `webfetch`, and `websearch`; each handler
receives its canonical typed V2 input and maintains an independent call index.
When a shell call sets `background: true`, Drive returns immediately with the
OpenCode tool call ID as `shellID`, keeps the handler running, and injects the
terminal `completed`, `error`, or `cancelled` result into the session
automatically. Background handlers are cancelled when Drive shuts down.

Type-check every new or edited script before running it:

```sh
opencode-drive check ./drive.ts
```

Drive resolves its script API, Effect, Bun declarations, and `tsgo` from the
launching installation without installing packages or modifying the script's
directory. When it detects an old Promise-style `setup`, `run`, or `ui.waitFor`
callback, it prints the equivalent Effect shape after the TypeScript
diagnostics. Use `Effect.sleep(milliseconds)` for unconditional delays.

The `fs`, `ui`, `llm`, `tools`, `server`, and `tuis` capabilities expose
Effect-returning operations. Compose them with `yield*`, `Effect.flatMap`, or
other Effect operators. Scripts receive the same `Ui`, `Tui`, `Tuis`, and TUI
options as `OpenCodeDriver`; `defineScript` does not define a second
programmatic interface. Predicates passed to `ui.waitFor` may return a boolean
or an Effect. Set `launch: "manual"` to launch the shared OpenCode server and
every TUI explicitly:

```ts
import { Effect } from "effect"
import { defineScript } from "opencode-drive"

export default defineScript({
  launch: "manual",
  run: ({ ui, server, tuis }) =>
    Effect.gen(function* () {
      // ui is null in manual mode.
      yield* server.launch()
      const alice = yield* tuis.launch("alice")
      const bob = yield* tuis.launch("bob")
      yield* alice.ui.submit("Hello from Alice")
      yield* bob.ui.screenshot("bob-view")
    }),
})
```

Only one server may be launched per script. All TUIs share its LLM backend. TUI
processes and compiled script artifacts are cleaned up when the script ends.

`yield* server.kill()` stops the server so it can be launched again later.
`yield* tui.close()` closes a TUI, after which its name may be reused.

Pass `{ recording: true }` to record an individual TUI:

```ts
const alice = yield* tuis.launch("alice", { recording: true })
yield* alice.ui.submit("Hello")
yield* alice.close()
```

Recordings are exported when the script settles. Call
`alice.recording.finish()` only when the video is needed before settlement.

Background title requests receive `OpenCode Drive` by default and do not
consume `llm.queue`, `llm.send`, or `llm.serve` responses. Manual-launch
scripts can customize them before starting the server:

```ts
yield* llm.title(() => Effect.succeed("Custom title"))
yield* server.launch()
```

Use `yield* llm.send(...)` to wait for and complete the next request or `yield*
llm.queue(...)` to declare future responses upfront. For ongoing responses,
the handler passed to `llm.serve` returns an Effect `Stream`:

```ts
import { Stream } from "effect"
import { Llm } from "opencode-drive"

yield* llm.serve((_request, index) =>
  Stream.make(Llm.text(`Response ${index + 1}`)),
)
```

The backend connection, default `finish("stop")`, and cleanup are automatic.
Cancellation is represented by Effect interruption: interrupting the script or
the fiber running an operation interrupts its in-flight work and runs scoped
finalizers. There is no Promise compatibility shim or separate cancellation
API. All public script types are canonically defined in
[`src/script/types.ts`](./src/script/types.ts), which can be provided directly
to an authoring agent.

`Llm.text()` streams text in randomized chunks. It defaults to a 2 ms delay and
a target chunk size of 15 characters, varied by plus or minus 5 per chunk:

```ts
Llm.text("A deliberately slower response", { delay: 20, chunkSize: 10 })
```

`Llm.reasoning()` accepts the same streaming options. Use
`Llm.pause(milliseconds)` to add timing between any two outputs.

`Llm.toolCall()` emits a complete call atomically by default. Pass the same
streaming options to expose partial JSON input while it is generated:

```ts
Llm.toolCall(
  {
    index: 0,
    id: "call_patch",
    name: "patch",
    input: { patchText: "*** Begin Patch\n*** End Patch" },
  },
  { delay: 40, chunkSize: 12 },
)
```

Finish a tool-calling response with `Llm.finish("tool-calls")`. Streamed calls
drive OpenCode's normal tool-input start, delta, and end lifecycle; `Llm.raw()`
remains available for provider-wire scenarios not covered by these helpers.

Current OpenCode simulation endpoints expose a semantic UI tree alongside
renderer state and terminal capture. Use `ui.snapshot()` for the complete
versioned tree or `ui.getNode()` to poll for one exact semantic match. Semantic
nodes carry stable IDs, optional occurrence identity, role, label, hierarchy,
component-owned state, and a transient element handle that `ui.click()` can
resolve safely:

```ts
const allow = yield* ui.getNode({
  role: "option",
  label: "Allow once",
  selected: true,
  disabled: false,
})

yield* ui.click(allow)
```

`ui.snapshot` and atomic semantic clicks are negotiated as optional
capabilities so ordinary operations remain compatible with older OpenCode
checkouts. Calling `ui.snapshot()`, `ui.getNode()`, or `ui.click(node)` when its
required capability is unavailable fails locally with `UiCapabilityError`.

Capability errors are typed and the concrete classes are grouped under
`Errors`. UI timeouts remain owner-fatal even when caught; recover locally
from errors for which the script has a truthful fallback:

Polling timeouts from `ui.waitFor`, `ui.getElement`, and `ui.getNode` make one
best-effort, bounded `ui.capture` request. When it succeeds, the resulting
normalized terminal frame is available as `error.frame` without creating or
retaining a screenshot file. RPC-level timeouts and failed diagnostic captures
leave `error.frame` undefined.

```ts
import { Effect } from "effect"
import { Errors } from "opencode-drive"

yield* ui.getElement({ editor: true }).pipe(
  Effect.catchTag("UiElementAmbiguousError", (error) =>
    Effect.logWarning(`Matched ${error.count} editors`),
  ),
)

const isFileSystemError = (error: unknown) =>
  error instanceof Errors.FileSystemError
```

## Release validation

Before publishing a release, run the non-publishing validation command to
check, test, and inspect the packed artifact:

```sh
bun run release:validate
```
