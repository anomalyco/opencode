# Simulation Implementation Phases

Status: implementation plan for `specs/simulation/simulation.md`.

The full simulation architecture is intentionally broad. This document breaks it into phases that can be implemented and reviewed incrementally.

## Phase 1: Control Surface And Observability

Goal: start the normal app in simulation mode and inspect/drive the TUI through an external WebSocket driver.

This phase proves the core shape without swapping every foundational layer yet.

Implementation checklist:

- [x] Add `OPENCODE_SIMULATION=1` activation in V1/full-TUI startup.
- [x] Add simulation trace service with in-memory append-only records.
- [x] Add OpenTUI UI state extraction for screen, focus, elements, and generated actions.
- [x] Add OpenTUI UI action execution for typing, keys, enter, arrows, focus, and click.
- [x] Add reusable JSON-RPC WebSocket server on `127.0.0.1:40900+`.
- [x] Expose `ui.state`, `ui.action`, `ui.render`.
- [x] Expose `trace.list`, `trace.clear`, `trace.export`.
- [x] Wire visible V1/full-TUI renderer path through the same action protocol.
- [ ] Verify a local driver can inspect state and execute a real TUI input.

Scope:

- Add `OPENCODE_SIMULATION=1` activation.
- Start a TUI-owned JSON-RPC WebSocket server on `127.0.0.1:40900+`.
- Expose `ui.state`, `ui.action`, `ui.render`.
- Use the old simulation action model: type text, press keys, press enter, arrows, focus, click.
- Support fake OpenTUI renderer and visible renderer through the same action protocol.
- Add in-memory append-only trace with `trace.list`, `trace.clear`, `trace.export`.
- Record UI observations, generated actions, executed actions, errors, and render/stabilization events.

Done when:

- `OPENCODE_SIMULATION=1 bun run dev` starts the normal app.
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

Scope:

- Wire simulation replacements through `AppNodeBuilder.build(...)` and `AppNodeBuilderV1.build(...)`.
- Create a real, empty anchor directory (`mkdtemp`) and `process.chdir` into it before any command resolves its working directory; skip creation when the runner already spawned the app inside an anchor.
- Root the in-memory filesystem at `process.cwd()` (the anchor). No cwd monkey-patching: cwd, `$PWD`, and `path.resolve()` stay truthful.
- Add snapshot loading from `OPENCODE_SIMULATION_STATE`: read the snapshot directory once at startup and seed the in-memory filesystem (snapshot `project/` paths joined onto the anchor root), config, env, and optional LLM/network state from it.
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
- The app boots from a snapshot directory via `OPENCODE_SIMULATION_STATE` and observes the seeded project files, config, and env through normal app paths.
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
