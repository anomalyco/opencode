# OpenCode Driver Architecture

This guide describes the current Effect-native architecture. The public call
sites are documented in [OpenCode Driver API](./open-code-driver-api.md).

## Domain Model

`OpenCodeDriver` composes these resources:

```text
OpenCodeDriver
  project       isolated files and configuration
  opencode      generated OpenCode SDK client
  tui           primary frontend process
  tuis          additional frontend process factory
  ui            convenience alias for tui.ui
  llm           shared simulated-model control
  tools         runtime control for static adapters and arbitrary tools
```

The names distinguish the two kinds of client involved:

- `opencode` is the generated `@opencode-ai/client` SDK value.
- `Tui` is a launched OpenCode frontend process with `ui`, `close`, and an
  optional `recording`.
- `Tuis` launches and supervises additional frontend processes connected to
  the same server.
- `tools.control` accepts independently controlled invocations for adapters
  declared before OpenCode starts.
- `tools.attach` and `tools.take` control arbitrary native tools through the
  canonical provider-backed lifecycle.
- Transport-level JSON-RPC clients remain private implementation details.

`defineScript` consumes these exact capabilities. It adds a branded module
contract, restart behavior, filesystem access, and explicit manual launch. It
does not define another UI, TUI, LLM, or project vocabulary.

## Ownership

```text
Effect Scope
  OpenCodeProject
    artifact root
    isolated project files
  OpenCodeInstance
    server process
    TUI processes
    launch descriptors and logs
    CLI script ToolController
      controlled invocation exchanges
  OpenCodeServer
    backend simulation connection
    reconnecting tool-only backend connection
    LLM controller
    dynamic ToolProducer
    generated OpenCode SDK connection
    TUI supervisor
      primary TUI scope
      additional TUI scopes
  Library ToolController
    controlled invocation exchanges
```

Library drivers create their ToolController before project preparation and
pass that controller into `OpenCodeInstance`. CLI scripts create the controller
inside `OpenCodeInstance`. Prepared drivers and script contexts combine the
instance's static controller with the server's dynamic producer. The static
controller that wrote plugin configuration remains the one exposed through
`tools.control`.

`OpenCodeDriver.make(options)` requires `Scope.Scope`. It returns once the
server, generated SDK client, primary TUI, and simulation connections are
ready. `OpenCodeDriver.use` supplies that scope and performs terminal
settlement even when the user program fails.

## Settlement

Settlement is one shared terminal operation. It runs in this order:

1. Validate that queued LLM work was consumed.
2. Validate that native dynamic-tool invocations were settled.
3. Shut down the LLM controller.
4. Finish active recording timelines.
5. Close all TUI scopes and processes.
6. Export completed recordings.
7. Decode the schema-validated `RunReport`.

`driver.settle()` is shared and idempotent. Once settlement starts, `tuis`
rejects new launches and `llm` rejects new responses. `OpenCodeDriver.use`
combines a user-program failure with a settlement failure rather than hiding
either cause.

## Tool Control Lifecycle

`ToolController` installs only statically declared or callback-registered
adapters into OpenCode's project configuration. Each runtime-controlled tool
owns one exchange that matches incoming requests to exact-ID or FIFO waiters.
Each accepted call owns a terminal Deferred, an interruption Deferred, and a
one-permit Semaphore that serializes progress with terminal commitment.

Controller scope release closes blocked waiters, marks unresolved calls
interrupted, aborts active HTTP transports, and waits for handler finalizers.
Terminal commitment uses a synchronous first-writer-wins Deferred completion;
Drive guarantees exactly-once acceptance inside the controller, not delivery
across a transport disconnect.

`ToolProducer` owns a separate backend socket because LLM chunks are not
idempotent and an LLM socket closure is terminal to `LlmController`. Dynamic
tool progress and terminal RPCs are idempotent by producer invocation ID and
sequence, so the tool-only connection may reconnect and replay pending
invocations safely. One ordered event stream preserves invocation-before-
cancellation order. The desired registration set survives reconnects and
manual server relaunches; invocation records are scoped to one server
generation because producer IDs may be reused by a new process.
Settlement first clears the dynamic registration set on OpenCode, then drains
the ordered local event stream before checking for unresolved invocations. The
clear acts as the server-side barrier that prevents a native invocation from
appearing after a successful settlement snapshot. Settlement is terminal for
dynamic attachment. Reconnects remain available while the clear is in flight;
the final connection gate drains any reconnect that landed during settlement
before preventing further backend creation. If the server generation has
already ended, its teardown has cleared the generation-scoped invocation
records, so settlement does not wait for a replacement backend.

## TUI Lifecycle

`Tuis.launch(options)` generates an internal identity. `Tuis.launch(name,
options)` uses a stable caller-supplied identity. Both return the same value:

```ts
interface Tui {
  readonly ui: Ui
  readonly close: () => Effect.Effect<void>
  readonly recording?: Recording
}
```

Each TUI owns one frontend process, one negotiated UI connection, and
optionally one recording timeline. Closing a named TUI releases its identity
for reuse. An unexpected process exit fails the owning driver or script.

The primary TUI is not a special interface. `driver.tui` and values returned
by `driver.tuis` have exactly the same `Tui` type. `driver.ui` is only
`driver.tui.ui` exposed for the common single-TUI call site.

## OpenCode SDK

The server process writes an authenticated service registration into its
isolated state directory. `driver/opencode.ts` discovers that registration and
constructs the generated Effect SDK client with the project directory header.
Passwords and registration paths remain internal. The resulting value is
exposed as `driver.opencode` and `ScriptContext.opencode`.

## Canonical Protocol

`simulation/protocol.ts` contains the single schema definition for OpenCode's
handshake, frontend, and backend simulation messages. `client/protocol.ts`
publishes those namespaces without redefining their data types.

```text
Frontend protocol schemas
  -> driver/ui.ts        Effect Ui capability
  -> driver/client.ts    Tui and Tuis lifecycle
  -> driver/index.ts     OpenCodeDriver aggregate
  -> script/types.ts     exact capability reuse
```

CLI `--command.ui.*` names are exhaustively checked against
`Frontend.Capabilities`. The Promise transport under `opencode-drive/client`
is separate from the Effect programmatic model but consumes the same protocol
schemas.

## Transport Seam

`SimulationConnector` owns WebSocket acquisition, handshake negotiation,
schema validation, request correlation, interruption, and connection failure.
The driver receives the connector through an Effect service and does not
expose it in userland.

The UI connection is request-response JSON-RPC. The LLM backend additionally
receives unsolicited `llm.request` notifications. The tool-only backend keeps
ordered `tool.invocation` and `tool.cancel` notifications on one validated
stream and does not call `llm.attach`.

## Project Setup

Neutral project contracts live in `src/project.ts` so neither the driver nor
scripts own the shared vocabulary:

```text
Project
Setup
SetupContext
ProjectFileSystem
OpenCodeConfig
OpenCodeTuiConfig
```

Configuration is applied in this order:

1. Write declared project files.
2. Read fixture `opencode.jsonc` and `tui.jsonc` values.
3. Deep-merge `config` and `tuiConfig`; arrays replace existing arrays.
4. Run Effect-only `setup`, which may mutate both merged objects.
5. Write normalized JSON and optionally commit the Git baseline.

## Dependency Direction

```text
project     -> Effect and Schema
simulation  -> canonical protocol and Effect RPC
driver      -> project + simulation + instance + recording
script      -> project + driver capabilities
cli         -> script + driver + Promise transport
```

Lower-level modules do not import the package root or the driver/script
barrels. `script/types.ts` may reference driver capabilities; driver modules
must not reference script types.

## Public Entry Points

- `opencode-drive`: Effect driver, scripts, project contracts, LLM constructors.
- `opencode-drive/driver`: complete Effect driver namespace.
- `opencode-drive/script`: `defineScript` and script contracts.
- `opencode-drive/client`: Promise simulation transport.
- `opencode-drive/llm`: pure LLM output constructors and schemas.
- `opencode-drive/recording`: recording decode, replay, and export utilities.
