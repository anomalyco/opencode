# Simulation Implementation Phases

Status: implementation plan for `specs/simulation/simulation.md`.

The full simulation architecture is intentionally broad. This document breaks it into phases that can be implemented and reviewed incrementally.

## Phase 1: Control Surface And Observability

Goal: start the normal app in simulation mode and inspect/drive the TUI through an external WebSocket driver.

This phase proves the core shape without swapping every foundational layer yet.

Implementation checklist:

- [x] Add `OPENCODE_DRIVE=<name>` activation in V1/full-TUI startup.
- [x] Add simulation trace service with in-memory append-only records.
- [x] Add OpenTUI UI state extraction for screen, focus, elements, and generated actions.
- [x] Add OpenTUI UI action execution for typing, keys, enter, arrows, focus, and click.
- [x] Add reusable JSON-RPC WebSocket server at the manifest's UI endpoint.
- [x] Add `simulation.handshake` protocol, role, identity, version, and capability negotiation to both control endpoints.
- [x] Expose `ui.state`, `ui.action`, `ui.render`.
- [x] Expose `trace.list`, `trace.clear`, `trace.export`.
- [x] Wire visible V1/full-TUI renderer path through the same action protocol.
- [ ] Verify a local driver can inspect state and execute a real TUI input.

Scope:

- Add `OPENCODE_DRIVE=<name>` activation.
- Start a TUI-owned JSON-RPC WebSocket server at the manifest's UI endpoint.
- Expose `ui.state`, `ui.action`, `ui.render`.
- Use the old simulation action model: type text, press keys, press enter, arrows, focus, click.
- Support fake OpenTUI renderer and visible renderer through the same action protocol.
- Add in-memory append-only trace with `trace.list`, `trace.clear`, `trace.export`.
- Record UI observations, generated actions, executed actions, errors, and render/stabilization events.

Done when:

- `OPENCODE_DRIVE=<name> bun run dev` starts the normal app and UI drive server.
- A local driver can connect to the WebSocket.
- The driver can inspect current screen/elements/actions.
- The driver can execute real TUI inputs.
- The trace shows observations and actions.

Out of scope:

- Backend layer replacement.
- Model-based runner.
- Generated plugin config.
- Deterministic replay tests.

## Phase 2: Foundational Simulation Layers

Goal: make the app safe and controlled by swapping the lowest layers, not app logic.

Implementation checklist:

- [x] Add `packages/simulation/src/backend` as the home for backend simulation layer replacements, exported from `backend/index.ts` as `simulationReplacements`; `@opencode-ai/simulation` is private/non-published and depends on logic/framework packages (`core`, `llm`, `effect`, OpenTUI), while `server` and `tui` consume it.
- [x] Wire simulation replacements through the server's `makeRoutes` via `Layer.unwrap` + dynamic `import("@opencode-ai/simulation/backend")` gated on `OPENCODE_SIMULATE`, so the simulation module is never loaded eagerly and `makeRoutes` stays synchronous.
- [x] Implement in-memory `FileSystem.FileSystem` (`simulation/filesystem.ts`) replacing the `NodeFileSystem` platform node. Backed by a flat path map; implements the operations the app uses (stat, access, chmod, realPath, read/write file, make/read directory, remove, rename, copy, copyFile, temp dirs, read-only open handles); unused operations die with a clear defect; `watch` fails as unsupported.
- [x] Root the fake filesystem at `process.cwd()` at layer-build time. The anchor is a real, empty host directory the runner creates and cds into.
- [x] Deny host filesystem escapes loudly: content/mutation operations outside the root fail with `PermissionDenied` simulation errors. Probe operations (`stat`/`access`/`exists`) report `NotFound` outside the root so walk-up loops (project discovery, `findUp`, `globUp`) terminate naturally.
- [x] Add `SimulationFSUtil` replacement (`simulation/fs-util.ts`): wraps the real `FSUtil` layer and reroutes `readDirectoryEntries`, `glob`, and `globUp` — which bypass the injected `FileSystem` via node `fs/promises` and the `glob` package — through the simulated filesystem.
- [x] Fix `LayerNode.hoist` conflict detection to compare node implementations instead of object identity; replacement rewriting produces dependency-rewritten copies of the same node, which previously false-positived as "conflicting implementations".
- [x] Add snapshot seeding from `OPENCODE_SIMULATE_STATE`: `files/` contents of the snapshot directory are read from the host once at layer-build time and seeded into the in-memory tree joined onto the anchor root.
- [x] Verify end to end: `opencode serve` boots with `OPENCODE_SIMULATE=1` + `OPENCODE_SIMULATE_STATE` + path/DB env seams (`OPENCODE_CONFIG_DIR`, `OPENCODE_TEST_HOME`, `OPENCODE_DB=:memory:`); `fs.list`/`fs.read` observe only seeded in-memory files; the anchor directory on the host remains empty after the run.
- [ ] Create the anchor directory + `chdir` + env seam setup automatically in CLI startup when simulation mode is enabled (currently set manually by the runner; a full run needs `OPENCODE_SIMULATE_STATE`, `OPENCODE_CONFIG_DIR`, `OPENCODE_TEST_HOME`, `OPENCODE_DB=:memory:`, and `XDG_*_HOME` pointed into the anchor, plus Bun's `--preload=@opentui/solid/preload` when launched outside `packages/cli`).
- [ ] Assert the anchor directory is still empty at the end of the run (KV/log/flock still write through real XDG paths; they are contained in the anchor by the env seams but not yet in-memory).
- [x] Add run-local simulated network (`packages/simulation/src/backend/network.ts`): replaces the `httpClient` platform node, resolves outbound HTTP against routes supplied at acquisition, denies unknown destinations loudly, and keeps an isolated bounded request log timestamped through Effect `Clock` (design: `simulated-network-llm.md`).
- [x] Add a simulated model provider behind the OpenAI route (`simulated-provider.ts` + `openai.ts`): real provider requests call `SimulatedProvider.Service.stream`; the Drive adapter streams response events back as schema-checked OpenAI Chat SSE consumed by the real protocol pipeline.
- [x] Scope the backend Drive control WebSocket, pending provider invocations, queues, and request fibers to `SimulatedProvider.layerDrive`. JSON-RPC remains at the named manifest's backend endpoint: `llm.attach` replays pending invocations; `llm.chunk`, `llm.finish`, `llm.disconnect`, and `llm.pending` control them; `llm.request` reports provider-native requests.
- [x] Scope the frontend Drive control WebSocket, request queue, renderer, and optional recording timeline to the TUI Effect scope. Server shutdown and request interruption precede renderer destruction; timeline finalization runs last and remains explicitly finishable through `ui.recording.finish`.
- [x] Decode Drive manifests through Effect `Config`, `FileSystem`, and `Schema`, with typed config, not-found, read, and decode failures.
- [x] Answer `https://models.dev/api.json` with an empty catalog in the simulated network; providers come from seeded config (`opencode.json` in the snapshot defines an openai-compatible provider with a dummy `apiKey`, which passes the catalog availability gate and resolves onto the real openai-chat route).
- [x] Fix `buildLocationServiceMap` to apply replacements when compiling hoisted global nodes; platform-node replacements (filesystem, httpClient) were silently ignored inside hoisted globals.
- [x] Verify end to end headless (real route stack in-process + backend control WS: prompt -> `llm.request` -> driver chunks -> assistant message contains driver text; script: `packages/server/script/e2e-sim.ts`) and through the TUI (fake renderer, both sockets: type + submit via TUI WS, answer `llm.request` via backend WS, assistant reply rendered on screen; script: `packages/tui/script/sim-llm-driver.ts`).
- [ ] Add simulated process registry (shell via `just-bash`, minimal fake `git`, deny unsupported spawns).
- [ ] Trace filesystem, process, and simulated provider activity (network requests are traced in the backend network log ring buffer; provider trace records still need adding on the backend control server).

Scope:

- Wire simulation replacements through `AppNodeBuilder.build(...)` and `AppNodeBuilderV1.build(...)`.
- Create a real, empty anchor directory (`mkdtemp`) and `process.chdir` into it before any command resolves its working directory; skip creation when the runner already spawned the app inside an anchor.
- Root the in-memory filesystem at `process.cwd()` (the anchor). No cwd monkey-patching: cwd, `$PWD`, and `path.resolve()` stay truthful.
- Add snapshot loading from `OPENCODE_SIMULATE_STATE`: read the snapshot directory once at startup and seed the in-memory filesystem (snapshot `files/` paths joined onto the anchor root), config, env, and optional LLM/network state from it.
- Route config/data/state/cache/temp paths into the simulated space using existing env seams (`OPENCODE_CONFIG_DIR`, `OPENCODE_TEST_HOME`, `OPENCODE_DB=:memory:`), set before `packages/core/src/global.ts` import-time path setup runs.
- Deny host filesystem escapes loudly (paths outside the anchor root fail with typed simulation errors).
- Assert the anchor directory on the host is still empty at the end of the run; anything written there means a code path bypassed the simulated filesystem.
- Add simulated network registry and deny unknown external network by default.
- Add scriptable LLM boundary.
- Add simulated process registry:
  - shell through `just-bash` against the simulated filesystem.
  - minimal fake `git` support for discovery/status paths.
  - deny unsupported process spawns.
- Add simulation-gated backend control routes, proxied only through the frontend WebSocket.
- Expose backend methods through the frontend server: filesystem seed/write, network register, LLM enqueue, backend snapshot.
- Trace filesystem, network, LLM, process, and backend control activity.

Done when:

- Unknown network fails with a simulation error.
- Host filesystem escape fails with a simulation error.
- The anchor directory on the host is empty after a run.
- The app boots from a snapshot directory via `OPENCODE_SIMULATE_STATE` and observes the seeded project files, config, and env through normal app paths.
- A driver can seed a project filesystem.
- A driver can enqueue an LLM script and submit a prompt through the TUI.
- The real session/tool path consumes the scripted LLM behavior.
- Shell commands use `just-bash`; unsupported process spawns fail.
- Trace contains backend activity and snapshots.

Out of scope:

- Model-based generation.
- Generated plugin config state.
- Shrinking.

## Phase 3: Generated Config And Model-Based Runner

Goal: explore different app states using generated commands and plugin-provided config state.

Scope:

- Add generated simulation plugins as the primary config-state generation mechanism.
- Support generated plugin domains for:
  - agents and defaults.
  - provider/model availability.
  - tool definitions and scripted tool behavior.
  - MCP-like capabilities or endpoints.
  - permission policies.
  - instructions/system-context-like inputs where supported.
  - workspace/project adapters where supported.
- Add runner commands to generate, enable, disable, and inspect generated plugin state.
- Build a custom external model-based runner, not `fast-check` yet.
- Runner command shape: precondition, execute, model update, postcondition.
- Runner model tracks only high-level observational state: screen category, prompt availability, sessions, files, queued LLM scripts, generated plugins, backend status, idle expectation.
- Generate valid command sequences from model state and current `ui.state.actions`.
- Record seed, command distribution, precondition rejections, generated plugin/config domain coverage, UI action coverage, and backend event coverage.

Done when:

- A seeded runner can generate a short valid exploration.
- The runner can generate plugin-provided config state without generating large arbitrary config files.
- The app loads and observes generated plugin state through normal plugin/config paths.
- The runner can type and submit prompts through the TUI using generated actions.
- Basic properties run after commands: no crash, no unknown network, no host FS escape, coherent stabilized state.
- Trace export includes enough state to replay the generated run later.

Out of scope:

- Shrinking.
- Coverage-guided mutation corpus.
- Differential testing.
- CI randomized runs.

## Phase 4: Replay, Promotion, And Campaigns

Goal: turn exploratory simulation into durable tests and prepare for larger campaigns.

Scope:

- Add replay from exported trace.
- Add deterministic replay test generation from successful or failing traces.
- Add stronger trace schema validation.
- Add property families beyond no-crash:
  - durable prompt admission is not lost.
  - no duplicated visible message IDs.
  - no orphan tool results.
  - queue/steer semantics hold at stabilization boundaries.
  - interrupt/resume does not duplicate promoted inputs.
- Add corpus storage for interesting traces.
- Add simple coverage/novelty scoring over UI states, backend event types, tool outcomes, generated config domains, and errors.
- Add long-running campaign mode outside normal CI.

Done when:

- A trace from Phase 3 can be replayed deterministically.
- A trace can be promoted to a normal test fixture.
- Campaign runs can collect interesting traces without committing randomized tests to CI.
- Failures produce a compact reproduction command and trace export.

Out of scope:

- Full shrinking.
- Deterministic scheduler/clock control.
- Parallel campaigns.
- Differential testing across app versions.

## Later Work

- Shrinking failed traces.
- Coverage-guided mutation of structured traces.
- `fast-check` integration if the custom runner becomes too limited.
- Differential testing across versions, renderers, storage modes, or scheduler policies.
- Deterministic clock/random/scheduler control.
- Parallel isolated workers.
- Model-generated properties with validity/soundness/coverage scoring.
