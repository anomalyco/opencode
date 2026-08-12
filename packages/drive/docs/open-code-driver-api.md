# OpenCode Driver API

Status: exploratory implementation, settled call sites only

This document records interface shapes that have been accepted during design. It intentionally omits unresolved alternatives rather than presenting them as competing proposals.

Internal resource ownership and desugaring are documented in [OpenCode Driver Architecture](./open-code-driver-architecture.md).

## Run Effect programs from the CLI

`opencode-drive run <module>` is the primary CLI entrypoint. The module must
default-export an `Effect<_, _, never>`. Before importing the module, Drive
generates and type-checks a contract entrypoint that assigns its default export
to that fully provided Effect type. Drive then imports the module, verifies the
value with `Effect.isEffect`, and yields it directly from the command handler.
There is no nested runtime or detached owner.

```ts
import { OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(({ ui }) => ui.screenshot("home"))
```

```sh
opencode-drive run ./drive.ts
```

The command accepts no flags and no arguments after `--`. Use the driver API in
the module for simulation control. `opencode-drive check` validates Effect-only
`defineScript` modules, and `start --script` executes them.

## `use` settles one scoped driver

`OpenCodeDriver.use(run)` is the zero-configuration top-level interface;
`OpenCodeDriver.use(options, run)` configures the same lifecycle. Both acquire
the driver returned by `make`, run the program, validate queued LLM work,
finish recordings, close TUIs, export videos, and then release the server
and project scope.

`OpenCodeDriver.useReport(run)` and `useReport(options, run)` have the same lifecycle semantics and
returns both the user value and a compact `RunReport`. The report contains
validated artifact and recording paths, retention, and endpoint compatibility.
Set `opencode.compatibility` to `"required"` or `"preferred"`;
the default is `"preferred"`, which negotiates when supported and reports an
explicit legacy profile otherwise.

```ts
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

const program = OpenCodeDriver.use(
  {
    project: {
      git: true,
      files: {
        "src/example.ts": "export const value = 1\n",
      },
    },
    config: {
      autoupdate: false,
    },
    tui: {
      viewport: {
        cols: 96,
        rows: 32,
      },
      recording: false,
    },
  },
  ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* llm.queue(
        Llm.text("The value is 1."),
      )

      yield* ui.submit("Read src/example.ts")
      yield* ui.waitFor("The value is 1.")
    }),
)

NodeRuntime.runMain(program)
```

`OpenCodeDriver.make(...)` remains the lower-level scoped constructor for programs that need to control settlement explicitly. Call `driver.settle()` before leaving its scope. `settle()` is terminal: it rejects new TUIs and LLM responses, validates queued work, stops TUIs, and exports recordings.

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const driver = yield* OpenCodeDriver.make(options)
    yield* driver.ui.submit("Hello")
    yield* driver.settle()
  }),
)
```

Capture font size is not part of this interface. The current renderer uses a fixed 16px font in 10-by-20 cells; the terminal catalog's `OPENCODE_DRIVE_FONT_SIZE=14` environment variable is currently ignored.

The generated SDK client is `opencode`. The primary frontend process is `tui`,
its UI is also available directly as `ui`, and `tuis` launches more frontend
processes:

```ts
const health = yield* driver.opencode.health.get()
const frame = yield* driver.tui.ui.capture()
const secondary = yield* driver.tuis.launch()
```

## The driver has one primary TUI and optional additional TUIs

The `tui` section configures the primary frontend created by `make`. Its UI is exposed directly as `ui` for the common case.

Additional TUIs connect to the same server and expose their own UI:

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const oc = yield* OpenCodeDriver.make({
      tui: {
        viewport: {
          cols: 96,
          rows: 32,
        },
      },
    })

    const secondary = yield* oc.tuis.launch({
      viewport: {
        cols: 120,
        rows: 40,
      },
      recording: true,
    })

    yield* oc.ui.submit("Prompt from the primary TUI")
    yield* secondary.ui.submit("Prompt from the secondary TUI")
    yield* oc.settle()
  }),
)
```

`tuis.launch(options)` generates an identity. Pass a name as the first argument
when a stable identity is useful for logs, recordings, or closing and
relaunching the same TUI: `tuis.launch(name, options)`.

```text
                     ╭────────────────╮
                     │ OpenCodeDriver ├───────────────────────╮
                     ╰────────┬───────╯                       │
             ╭────────────────╰──────────────────╮            │
             ▼                                   ▼            │
╭────────────────────────╮            ╭────────────────────╮  │
│ Shared OpenCode Server │            │ Shared LLM Control │  │
╰────────────┬───────────╯            ╰────────────────────╯  │
             ╰───────────────────────────────╮                │
             ▼                               ▼                │
    ╭────────────────╮            ╭────────────────────╮      │
    │  Primary TUI   │◀───────────│  Additional TUIs   │◀─────╯
    ╰────────┬───────╯            ╰──────────┬─────────╯
             ╰───╮                    ╭──────╯
                 ▼                    ▼
              ╭────╮            ╭───────────╮
              │ ui │            │  tui.ui   │
              ╰────╯            ╰───────────╯
```

## Common scripts destructure UI and LLM control

Scripts that only need the primary TUI should normally destructure the driver:

```ts
const driver = yield* OpenCodeDriver.make()
const { ui, llm } = driver

yield* llm.queue(
  Llm.text("Hello from the simulated model."),
)

yield* ui.submit("Hello")
yield* ui.waitFor("Hello from the simulated model.")
yield* driver.settle()
```

Keep the aggregate value only when driver-wide capabilities such as `tuis` are needed:

```ts
const oc = yield* OpenCodeDriver.make()
const secondary = yield* oc.tuis.launch()

yield* oc.ui.screenshot("primary")
yield* secondary.ui.screenshot("secondary")
yield* oc.settle()
```

## Runtime tool control uses statically declared adapters

Declare the built-in tool names Drive should intercept before OpenCode starts,
then control each invocation through the live `tools` capability. Undeclared
tools keep their real OpenCode implementations.

```ts
const program = OpenCodeDriver.use(
  { tools: ["shell"] },
  ({ tools, llm, ui }) =>
    Effect.gen(function* () {
      const shells = yield* tools.control("shell")
      yield* llm.queue(
        Llm.toolCall({
          index: 0,
          id: "call_build",
          name: "shell",
          input: { command: "bun run build" },
        }),
        Llm.toolCall({
          index: 1,
          id: "call_test",
          name: "shell",
          input: { command: "bun run test" },
        }),
        Llm.finish("tool-calls"),
      )
      yield* ui.submit("Build and test")

      const build = yield* shells.take("call_build")
      const test = yield* shells.take("call_test")
      yield* test.succeed({ output: "Tests passed\n", exit: 0 })
      yield* build.succeed({ output: "Build passed\n", exit: 0 })
    }),
)
```

`take(callID)` reserves and accepts one known invocation independently of
arrival order. `take()` accepts the oldest unclaimed invocation. Exact-ID
waiters take precedence over generic waiters, so parallel calls may settle in
any deliberate order. Each call may emit serialized progress and then succeed
or fail exactly once. `awaitInterrupted()` completes when transport or
controller interruption wins before terminal settlement.

The program must take and terminally settle every intercepted invocation it
expects. Driver scope closure fails blocked `take` operations, interrupts
unresolved calls, and waits for transport cleanup. The callback-style
`tools(registry)` configuration remains available
for fixed handlers; callback-controlled tools are not also available through
the runtime `tools.control` capability.

## Arbitrary tools use the provider-backed lifecycle

`tools.attach({ tools })` atomically replaces the complete dynamic registration
set for the current run. Registrations use OpenCode's canonical JSON Schema,
permission, namespace, and CodeMode options. Static `shell`, `webfetch`, and
`websearch` adapters remain installed separately.

```ts
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
      options: { codemode: false },
    },
  ],
})

const invocation = yield* tools.take("call_lookup")
yield* invocation.progress({
  structured: { phase: "searching" },
  content: [{ type: "text", text: "Searching" }],
})
yield* invocation.finish({
  structured: { answer: 42 },
  content: [{ type: "text", text: "42" }],
})
```

`take(callID)` matches `context.callID`, the model call ID supplied to
`Llm.toolCall`; `invocation.id` is the producer's transport identity. Drive
deduplicates invocation replay after a controller reconnect and retries
progress or terminal operations with the same producer identity and progress
sequence. `awaitCancelled()` observes OpenCode's native interruption. There is
no public cancel operation because cancellation flows from OpenCode to Drive.

Attaching a dynamic effective name that collides with a configured static
adapter fails locally. Calling `attach({ tools: [] })` clears the dynamic set.
Older OpenCode revisions remain compatible with static adapters and ordinary
LLM control; dynamic attachment fails with `Tool.LifecycleError` when the six
tool lifecycle capabilities are unavailable.

## LLM response description is separate from live LLM control

`Llm` is a pure data module. `llm` is the live capability that queues, sends, and serves responses.

```ts
yield* llm.queue(
  Llm.reasoning("Inspecting the file"),
  Llm.pause(20),
  Llm.text("The value is 1.", {
    delay: 2,
    chunkSize: 15,
  }),
  Llm.finish("stop"),
)
```

Each constructor returns an ordinary serializable value. Raw values with the same schema remain accepted.

Tool calls remain atomic when options are omitted. Supplying stream options
serializes the input to JSON and emits provider-neutral partial tool input when
the endpoint advertises that capability. Older endpoints retain the existing
OpenAI-compatible fallback:

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

The authoritative schema is a manual union of independently named variants:

```ts
export const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  options: Schema.optionalKey(StreamOptions),
})
export interface Text extends Schema.Schema.Type<typeof Text> {}

export const Reasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  options: Schema.optionalKey(StreamOptions),
})
export interface Reasoning extends Schema.Schema.Type<typeof Reasoning> {}

export const Pause = Schema.Struct({
  type: Schema.Literal("pause"),
  milliseconds: NonNegativeMilliseconds,
})
export interface Pause extends Schema.Schema.Type<typeof Pause> {}

export const Finish = Schema.Struct({
  type: Schema.Literal("finish"),
  reason: Schema.optionalKey(FinishReason),
})
export interface Finish extends Schema.Schema.Type<typeof Finish> {}

export const Output = Schema.Union([
  Text,
  Reasoning,
  Pause,
  Finish,
  ToolCall,
  Raw,
  Disconnect,
])
export type Output = Schema.Schema.Type<typeof Output>
```

Pure constructors delegate to those individual schemas:

```ts
export const text = (
  text: string,
  options?: StreamOptions,
): Text =>
  Text.make({
    type: "text",
    text,
    ...(options ? { options } : {}),
  })
```

No `.cases` interface appears in userland.

## One `queue` call describes one future model response

Multiple outputs in one call are ordered events within one response:

```ts
yield* llm.queue(
  Llm.toolCall({
    index: 0,
    id: "call_permission_capture",
    name: "patch",
    input: {
      patchText,
    },
  }),
  Llm.finish("tool-calls"),
)
```

A second call queues a response for the next model request:

```ts
yield* llm.queue(
  Llm.text("The fixture was updated."),
)
```

Responses without an explicit terminal output finish with `"stop"`. Title requests remain separate and do not consume this queue.

## `defineScript` is Effect-only

`defineScript` does not provide a Promise adapter. Its `setup` and `run`
callbacks return Effects, as do operations on `fs`, `ui`, `llm`, `server`,
and `tuis`. Compose script operations in the same runtime with
`yield*` or Effect operators.

### Primary UI

```ts
import { Effect } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* llm.queue(Llm.text("The value is 1."))
      yield* ui.submit("Read src/example.ts")
      yield* ui.waitFor("The value is 1.")
    }),
})
```

`llm.serve` accepts a handler that returns an Effect `Stream`. The registration
itself is also an Effect:

```ts
import { Stream } from "effect"
import { Llm } from "opencode-drive"

yield* llm.serve((_request, index) =>
  Stream.make(Llm.text(`Response ${index + 1}`)),
)
```

Predicates passed to `ui.waitFor` may return a boolean or an Effect.
Capability methods expose typed error channels. Concrete tagged errors are
available from the `Errors` namespace.

`ui.snapshot()` returns the endpoint's versioned semantic tree. `ui.getNode()`
polls for one exact match and fails with `UiNodeAmbiguousError` when more than
one node matches. Semantic snapshots and identity-checked semantic clicks are
optional during negotiation, so older OpenCode checkouts retain ordinary UI
control while unsupported semantic operations fail locally with
`UiCapabilityError`.

```ts
const option = yield* ui.getNode({
  role: "option",
  label: "Allow once",
  selected: true,
})
yield* ui.click(option)
```

### Additional TUI

```ts
yield* server.launch()
const alice = yield* tuis.launch("alice")
const bob = yield* tuis.launch("bob")

yield* alice.ui.submit("Hello from Alice")
yield* bob.ui.screenshot("bob-view")
```

### TUI configuration

```ts
export default defineScript({
  tui: {
    viewport: {
      cols: 118,
      rows: 34,
    },
  },
  run: ({ ui }) => ui.screenshot("home").pipe(Effect.asVoid),
})
```

Script cancellation uses Effect interruption. Interrupting the script or an
operation's fiber interrupts in-flight work and runs its scoped finalizers;
there is no `AbortSignal`, Promise cancellation convention, or compatibility
shim.

## Settled interface

- `OpenCodeDriver.use(run)` and `use(options, run)` are the safe top-level brackets and perform typed settlement.
- `OpenCodeDriver.make(options)` is the primary scoped constructor.
- `opencode` is the generated OpenCode SDK client.
- Programs that call `make` directly call terminal `driver.settle()` before leaving the scope.
- Direct library programs run the same Effect without any export convention.
- The `tui` section configures one primary TUI.
- The primary TUI's UI is exposed as `ui` and `oc.ui`.
- The common case destructures `{ ui, llm }`.
- `oc.tuis.launch(options?)` creates an additional TUI with a generated identity.
- `oc.tuis.launch(name, options?)` creates a TUI with a stable identity.
- Additional TUIs expose their UI as `tui.ui`.
- Drivers and scripts share the same `Tui`, `Tuis`, `Ui`, and option types.
- `Llm` exposes pure constructors over manually composed Effect Schemas.
- Raw schema-compatible LLM output objects remain accepted.
- One `llm.queue(...)` call describes one future model response.
