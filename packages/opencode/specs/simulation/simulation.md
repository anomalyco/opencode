# Opencode Simulation Architecture

Status: first milestone architecture draft.

## Goal

Build a simulation environment for exploring opencode through the real app, primarily through the TUI, while replacing only the lowest foundational layers needed to make runs controlled, observable, and safe.

The first milestone is an interactive exploration and model-based testing environment. It should be enough to start opencode normally, put the app into generated states, drive real user-level TUI actions, observe what happened, and record an in-memory trace that can later be exported into deterministic replay tests.

This is not intended to be a custom simulated app or a separate `simulate` command. The normal app should run, with simulation enabled by one required flag:

```sh
OPENCODE_SIMULATE=1 bun run dev
```

## Non-Goals

- Do not reimplement the app.
- Do not replace mid-level services like session processing, tool registry, provider orchestration, route trees, or TUI components unless a foundational seam proves impossible.
- Do not build shrinking in the first milestone.
- Do not make generated randomized runs part of CI yet.
- Do not build differential testing in the first milestone.
- Do not expose drive controls when `OPENCODE_DRIVE` is not set.

## Design Principles

- Run the real app through normal commands.
- Drive the TUI using real user-level input: typing, keypresses, focus, click, and mouse actions.
- Keep simulation code isolated under a simulation/testing area.
- Touch production app code only at narrow activation points: builders, TUI startup, foundational layers, and simulation-gated backend routes.
- Swap foundational layers, not app logic.
- Make observations rich enough for humans and models.
- Treat traces as first-class artifacts.
- Use a lightweight model of expected high-level behavior, not a clone of opencode internals.
- Generate valid commands from current observed state rather than blindly fuzzing impossible actions.

## Activation

`OPENCODE_SIMULATE=1` swaps the backend's foundational layers for simulated implementations. `OPENCODE_DRIVE=<name>` independently starts the frontend and backend control WebSockets using the exact endpoints from the named opencode-drive registry manifest. `OPENCODE_DRIVE=1` starts an unnamed instance at `ws://127.0.0.1:40900` for the UI and `ws://127.0.0.1:40950` for the backend.

Initial state is provided through an optional snapshot directory:

```sh
OPENCODE_SIMULATE=1 OPENCODE_DRIVE=demo OPENCODE_SIMULATE_STATE=/path/to/snapshot bun run dev
```

Optional flags can be added later, but should stay minimal. Reasonable optional parameters later include renderer mode, trace output path, seed, or port override.

All simulation parameters are environment variables, not CLI flags. This is a hard requirement: `packages/core/src/global.ts` computes and creates XDG paths at module import time, so anything that redirects paths must be in place before the first import. Environment variables set by the parent process (or read at the very top of startup) satisfy this; CLI flags parsed after imports do not.

When enabled:

- The app creates and changes into a real, empty anchor directory (see Filesystem).
- The app reads the snapshot directory, if provided, and seeds all simulated state from it.
- The app builds with simulation layer replacements.
- The TUI and backend processes start loopback WebSocket control servers when `OPENCODE_DRIVE` is set.
- Simulation-gated backend control routes become available only to the frontend/control path.
- In-memory trace recording starts automatically.

Path seams reuse existing environment variables where they already exist: `OPENCODE_CONFIG_DIR` for global config, `OPENCODE_TEST_HOME` for home, and `OPENCODE_DB=:memory:` for the database. Simulation mode should set these before foundational modules load rather than inventing parallel mechanisms.

## Control Servers

The UI control surface lives in the TUI/frontend process. A separate backend control surface handles simulated LLM and network operations.

This is important because the frontend has direct access to the renderer, screen state, focus state, interactable elements, and user input APIs. The backend remains the normal backend, with only simulation-gated control routes used internally by the frontend when needed.

Protocol:

- JSON-RPC 2.0 over WebSocket.
- Clients negotiate protocol version, endpoint role, and capabilities with `simulation.handshake` before using endpoint methods.
- Loopback only.
- `OPENCODE_DRIVE` names a manifest in the opencode-drive registry, or is `1` for the unnamed default endpoints.
- The manifest supplies exact loopback `ui` and `backend` WebSocket endpoints.
- Startup fails rather than scanning when either manifest endpoint is unavailable.
- External drivers connect to both WebSockets when they need UI and backend controls.

The app should not send JSON-RPC requests back to the driver in the first milestone. The driver sends requests; the app responds and emits notifications/events as useful.

The canonical handshake request is:

```ts
{
  jsonrpc: "2.0"
  id: string | number | null
  method: "simulation.handshake"
  params: {
    client: {
      name: string
      version: string
    }
    expectedRole: "ui" | "backend"
    offeredVersions: Array<number>
    requiredCapabilities: Array<string>
    optionalCapabilities: Array<string>
  }
}
```

The response result is:

```ts
{
  protocolVersion: 1
  role: "ui" | "backend"
  server: {
    name: string
    version: string
  }
  capabilities: Array<string>
}
```

Capabilities are open strings. Each endpoint advertises only methods and notifications it actually implements. A role mismatch, no supported offered protocol version, or a missing required capability fails the request; unsupported optional capabilities do not.

Initial method groups:

- `ui.state`: return screen, elements, focus, and generated possible actions.
- `ui.action`: execute one real user-level action.
- `ui.render`: force or wait for a render and return state.
- `backend.filesystem.seed`: seed project files.
- `backend.filesystem.write`: write one file.
- `backend.network.register`: register a fake network response.
- `backend.llm.enqueue`: queue scripted LLM behavior.
- `backend.snapshot`: return backend simulation state.
- `trace.list`: return trace records.
- `trace.clear`: clear in-memory trace.
- `trace.export`: export trace JSON for replay/test generation.
- `run.stabilize`: wait for frontend/backend quiescence and return observations.

## TUI Actions

The old simulation branch had the right basic shape: observe OpenTUI renderables, derive executable actions, and execute those actions through OpenTUI input/mouse APIs.

The first action vocabulary should stay close to that work:

```ts
type UIAction =
  | { type: "typeText"; text: string }
  | { type: "pressKey"; key: string; modifiers?: KeyModifiers }
  | { type: "pressEnter" }
  | { type: "pressArrow"; direction: "up" | "down" | "left" | "right" }
  | { type: "focus"; target: number }
  | { type: "click"; target: number; x: number; y: number }
```

`ui.state` should return:

- Current screen text.
- Focused renderable/editor state.
- Interactable elements.
- Generated actions valid for the current UI state.

Elements should include stable-enough semantic data where available:

- Renderable ID and numeric target.
- Position and dimensions.
- Focusable/clickable/editor flags.
- Focused flag.
- Text or label when available.
- Role/capability when available.

Both fake OpenTUI renderer and visible terminal renderer should share this protocol. The architecture should support both; the default can be decided later.

## Backend Control

The backend server should be exactly the normal backend server.

Simulation-only backend routes may exist, but only when `OPENCODE_SIMULATE=1`. They are private implementation details for commands like filesystem seeding, LLM scripting, network registration, and snapshots.

External drivers should not use backend simulation routes directly.

## Foundational Layer Replacement

Current `origin/dev` has the right seam: `AppNodeBuilder.build(...)` and `AppNodeBuilderV1.build(...)` accept replacements over `LayerNode`s. Simulation should use those seams instead of adding large alternate app assemblies.

First milestone replacements:

- Filesystem.
- Network / HTTP client.
- LLM boundary.
- Process spawner.

First milestone generated state surfaces:

- Filesystem/project state.
- Network responses.
- LLM scripts.
- Process registry behavior.
- Plugin-generated config state.

Likely later replacements:

- Clock/random.
- Database path/isolation.
- Global paths/temp paths.

The goal is to swap things at the bottom of the app. Everything above these foundational services should behave as production code.

## Filesystem

The filesystem simulation is in-memory, anchored at a real empty directory.

On startup in simulation mode:

1. Create a real, empty anchor directory with `mkdtemp` (for example `$TMPDIR/opencode-sim-XXXXXX`).
2. `process.chdir(anchor)` before any command resolves its working directory.
3. Use `process.cwd()` — now the anchor — as the root of the in-memory filesystem.
4. Seed the in-memory filesystem from the snapshot directory, joining snapshot-relative paths onto the anchor root.

The anchor directory on the host stays empty for the entire run. All file content lives only in the in-memory filesystem.

Rationale for the real anchor:

- `process.cwd()`, `$PWD`, and `path.resolve()` are all genuinely correct with zero patching. The previous simulation branch used a virtual root (`/opencode`) that existed nowhere on the host, which forced monkey-patching `process.cwd` and `$PWD` and left raw `fs` relative-path resolution silently disagreeing with the faked cwd.
- The codebase reads `process.cwd()` at process edges (CLI entry points, TUI frontend, request-fallback in workspace routing) and converts it into an explicit `directory` value early; core never reads it directly. A truthful cwd at startup means every downstream consumer inherits the virtual root without touching those call sites.
- Leak detection is free: the anchor must be empty at the end of the run. Any file that appears there means some code path bypassed the simulated filesystem. This is an assertable invariant.
- Host filesystem bypasses read an empty directory instead of the developer's real project. Bypassed reads fail loudly instead of returning wrong-but-plausible data.

Rationale for in-memory content:

- The run is hermetic: no host writes, no cleanup dependencies, no cross-run contamination.
- Snapshots load and reset quickly, which matters for model-based runs that reset state often.
- The containment check (path must be inside the anchor root) doubles as the host-escape guard with a truthful boundary.

The in-memory filesystem is still controlled and isolated:

- Each run gets its own anchor root.
- Project files, config, data, state, cache, and temp paths should resolve inside that root (via `OPENCODE_CONFIG_DIR`, `OPENCODE_TEST_HOME`, and `OPENCODE_DB=:memory:`).
- Paths outside the anchor root fail loudly with a typed simulation error.
- Trace should record seeded files and file diffs/observations needed for replay.

The anchor may be created by the app itself at activation, or by an external runner that spawns the app with the anchor as its working directory. Both should work: the app creates and enters an anchor only when its current directory is not already a designated anchor.

## Initial State Snapshot

`OPENCODE_SIMULATE_STATE` points at a directory containing one complete initial state. On startup the app slurps this directory once and constructs all simulated state from it. The snapshot is never written back to; it is a pure input.

Proposed layout:

```text
snapshot/
  files/...            # workspace files, seeded into the in-memory FS under the anchor root
  config/opencode.json # global config; the directory backs OPENCODE_CONFIG_DIR
  env.json             # extra environment values to apply
  llm/...              # scripted LLM behavior to pre-enqueue (optional)
  network/...          # network response registrations (optional)
```

Rules:

- Paths inside `files/` are snapshot-relative. The loader joins them onto the anchor root, so absolute virtual paths look like real host paths under the anchor.
- Anything the config references (skills, instructions, reference paths) must exist inside `files/`. A snapshot that references missing files is invalid.
- The snapshot directory format is the contract between external state generators and the app. Generators (such as the opencode-probe project) produce snapshot directories plus a derived expected model; the app consumes only the snapshot.
- Seeding through the control server (`backend.filesystem.seed` and friends) remains available for incremental changes during a run; the snapshot covers initial state.

## Configuration Via Generated Plugins

Generated configuration is a core first-milestone feature.

Much of opencode behavior is driven by config. The simulation runner needs to put the app into many different config-shaped states: different agents, tools, providers, MCP servers, permissions, modes, instructions, formatting settings, feature flags, and other config-dependent behavior.

The runner should not primarily generate arbitrary config files. Instead, the simulation should express config-shaped state as generated plugins.

Rationale:

- Plugins are already a normal extension surface for opencode behavior.
- Generated plugins can produce app states without making the simulation depend on config-file syntax and file layout details.
- Plugin-generated state keeps setup closer to runtime behavior: the app reads config, loads plugins, and observes plugin-provided behavior through normal app paths.
- Plugins are a better unit for model-based generation because they can be named, versioned, traced, reused, and minimized independently.

The first implementation should support generated simulation plugins that can contribute or affect config-equivalent domains such as:

- Agents and agent defaults.
- Provider/model availability.
- Tool definitions and tool behavior.
- MCP-like capabilities or endpoints.
- Permission defaults and policies.
- Instructions/system-context-like inputs where supported.
- Formatting/project behavior where supported.
- Workspace/project adapters where supported.

The simulation can still write the minimal bootstrap state needed for opencode to discover generated plugins, but the interesting generated state should live in plugin definitions rather than large generated `opencode.json` files.

Trace should record:

- Generated plugin IDs.
- Plugin-provided config/state fragments.
- Plugin hooks registered.
- Any plugin load/config errors.
- Which generated plugin state was active for each run.

The model-based runner should include commands for generating and enabling plugin state. These commands should have normal preconditions and postconditions just like UI actions or backend setup commands.

Example command families:

- Generate a provider/model plugin.
- Generate an agent configuration plugin.
- Generate a tool plugin with scripted behavior.
- Generate permission policy state.
- Generate MCP-like tool/resource state.
- Enable or disable a generated plugin for the next app run.

This is the main mechanism for exploring app states driven by configuration.

## Network

Unknown external network should fail loudly by default.

The simulation network should support explicit response registration:

- JSON response.
- Text response.
- Bytes response later if needed.
- Status-only response.
- Handler-style response later if needed.

Loopback traffic needed by the app/frontend/backend may be allowed explicitly.

All network calls should be traceable:

- Method.
- URL.
- Request headers/body where safe.
- Matched simulation route.
- Status.
- Response summary.
- Error if denied.

## LLM

The LLM boundary should be scriptable.

The driver can enqueue scripts that describe model behavior:

- Text chunks.
- Thinking/reasoning chunks if relevant.
- Tool calls.
- Errors.
- Finish reason.

The real session and tool pipeline should consume this behavior through the normal app path. The simulation should not bypass `SessionPrompt`, `SessionProcessor`, or tool execution.

Missing scripted LLM behavior should fail with a clear simulation error unless a default response is explicitly configured.

## Process Spawning

External process spawning should be denied by default.

The first milestone should provide a simulated process registry. This should be inspired by the old branch:

- Shell commands can run through `just-bash` against the simulated filesystem.
- A small fake `git` command set can support project discovery/status paths needed by the app.
- Unsupported process spawns fail loudly.

This preserves the rule that simulation does not spawn arbitrary external programs while still allowing useful shell/tool flows.

## Trace

Trace recording is always on in simulation mode, in memory for the first milestone.

Trace entries should be append-only JSON-compatible records. They do not need to be written to disk initially, but `trace.export` should return a structure suitable for later replay and test generation.

Trace should include:

- Run metadata: seed, app version, renderer mode, WebSocket URL.
- Initial world setup.
- UI observations.
- Generated UI actions.
- Executed UI actions.
- Backend control requests.
- Backend snapshots.
- Network requests and matches/denials.
- LLM scripts enqueued and consumed.
- Tool calls and results.
- Permission decisions.
- Filesystem seed/write/diff summaries.
- Generated plugin/config state and load results.
- Stabilization boundaries.
- Errors and crashes.
- Model command execution and postcondition results.

The trace is the bridge between exploratory simulation and deterministic tests.

## Model-Based Runner

The first runner is an external driver connecting to the frontend WebSocket.

Use a custom runner for now, not `fast-check`. It should still follow the core shape used by property/model-based testing libraries:

```ts
interface Command<Model> {
  readonly name: string
  check(model: Model): boolean
  run(model: Model, app: SimulationClient): Promise<void>
}
```

Basic runner responsibilities:

- Keep a lightweight model of high-level expected state.
- Generate commands whose preconditions match the model and current app observations.
- Execute commands through the WebSocket.
- Update the model.
- Check postconditions/invariants.
- Record all steps in the trace.
- Support seed/replay.
- Track simple distribution stats.

The model should track high-level, observational state only, such as:

- Current screen/route category.
- Whether prompt editor is available.
- Known sessions.
- Known files and expected file contents/diffs.
- Queued LLM scripts.
- Recent backend/session status.
- Whether app is expected to be idle.

The model must not track implementation internals like fibers, exact runner loop state, cache internals, or database implementation details.

Initial command families:

- Seed filesystem.
- Generate and enable plugin config state.
- Register network response.
- Enqueue LLM script.
- Observe UI state.
- Execute one generated UI action.
- Type prompt text.
- Press enter.
- Stabilize.
- Assert no crash.
- Assert visible response or file effect.
- Export trace.

## Generators

The first milestone should include generation, but not shrinking.

Generation should be model-based and state-aware:

- Generate from currently valid `ui.state.actions`.
- Generate backend setup commands from scenario/model state.
- Generate plugin-provided config state.
- Generate LLM scripts that match likely user prompts and tool flows.
- Generate short command sequences using preconditions.
- Use a seed so runs can be replayed.
- Use simple weights to avoid degenerate action selection.

The generator should not attempt to produce arbitrary full app states upfront. It should build state by executing commands through the real app and observing the result.

Important stats to record:

- Seed.
- Command counts.
- Action type distribution.
- Generated plugin/config domain distribution.
- Rejected command/precondition counts.
- UI element/action coverage.
- Backend event type coverage where available.
- Errors and stabilization failures.

## Properties

First milestone properties should be simple and high-signal:

- App does not crash.
- Backend does not crash.
- Unknown network is denied.
- Host filesystem escape is denied.
- Prompt submission can reach a scripted LLM response.
- Stabilization eventually reaches a coherent idle state for the demo flow.
- File effects from scripted tool behavior are observable in the simulated filesystem.
- Trace contains enough information to replay the run.

More advanced model/refinement, metamorphic, and differential properties are future work.

## First Demo Flow

The first major demo should show this system as a real environment for exploring the app in controlled states:

1. Start opencode normally with `OPENCODE_SIMULATE=1` and `OPENCODE_DRIVE=<name>`.
2. TUI and backend start their drive WebSockets at the named manifest endpoints.
3. External runner connects.
4. Runner provides a snapshot directory (or seeds the in-memory project filesystem through the control server).
5. Runner generates and enables plugin-provided config state.
6. Runner queues a scripted LLM response.
7. Runner observes `ui.state` and generated actions.
8. Runner drives real TUI input to type and submit a prompt.
9. App processes the prompt through the real backend/session/tool path.
10. Scripted LLM response appears or executes a file-affecting tool flow.
11. Runner stabilizes the app.
12. Runner inspects trace, backend snapshot, UI state, generated plugin state, and filesystem state.
13. Runner exports a deterministic replay trace.

## Done-When Checklist

- `OPENCODE_SIMULATE=1` starts the normal app with simulation wiring.
- `OPENCODE_DRIVE=<name>` starts both drive WebSockets at the manifest endpoints.
- Simulation code is isolated under a dedicated simulation/testing area.
- App changes outside simulation are limited to activation hooks, builder replacements, TUI startup, and gated backend routes.
- TUI and backend expose JSON-RPC WebSockets at the manifest endpoints.
- Driver can call `ui.state`.
- Driver can execute generated UI actions.
- Fake and visible renderer paths use the same action protocol.
- Driver can seed filesystem state.
- Driver can generate and enable plugin-provided config state.
- Driver can register network responses and observe denied unknown network.
- Driver can enqueue LLM scripts.
- External process spawning is denied by default, with shell via `just-bash` and minimal fake process registry support.
- Driver can run a basic model-based generated command sequence.
- In-memory trace records observations/actions/backend interactions.
- Driver can list, clear, and export trace.
- Demo flow succeeds end-to-end.

## Future Directions

- Shrinking failed traces.
- Promote minimized traces into normal committed tests.
- Coverage-guided corpus and structured trace mutation.
- Richer semantic UI grounding for model-driven exploration.
- LLM-generated property proposals with validity/soundness checks.
- Differential testing across app versions, renderers, or storage modes.
- Deterministic scheduler/clock/random control.
- Parallel campaigns with isolated workers.
- File-backed trace persistence and replay CLI.
