# Driver Consolidation Plan

## Goal

Make the Effect-native driver the single owner of OpenCode Drive lifecycle behavior. Make `defineScript` Effect-only alongside ordinary Effect programs, add deterministic OpenCode TUI configuration, return structured run evidence with validated path types, and replace protocol-skew timeouts with explicit compatibility negotiation.

## Status

Phases 0 through 5 are complete. The consolidated Effect lifecycle, typed OpenCode SDK, structured run reports, and negotiated simulation compatibility shipped by `opencode-drive@1.0.0`; runtime tool controls and run-scoped media followed in `1.1.0` and `1.2.0`. The active work is the provider-neutral tool lifecycle and semantic UI snapshot protocol described under Follow-Ups.

## Invariants

- `OpenCodeDriver.use` is the default safe lifecycle boundary.
- `defineScript` has no Promise API or compatibility shim: `setup` and `run` return Effects.
- Script `fs`, `ui`, `llm`, `server`, and `tuis` operations return Effects; `llm.serve` handlers return Streams.
- Script cancellation is Effect interruption and runs scoped finalizers.
- Manual scripts retain server kill/relaunch and named multi-TUI behavior.
- CLI `--command.ui.*` names and payloads remain identical to OpenCode's canonical frontend protocol.
- OpenCode configuration is expressed through normal `opencode.jsonc` and `tui.jsonc` files, not Drive-specific runtime flags.
- Backend simulation control remains in programs, not CLI commands.
- Every process, socket, worker, timeline, and temporary project has one lifecycle owner.
- Protocol compatibility is reported truthfully; legacy fallback is never described as negotiated compatibility.
- Filesystem paths crossing public boundaries are schema-validated branded values.

## Phase 0: Release Correctness (Completed)

1. Correct the skill's targeted prune example to use the instance name.
2. Preserve the final off-grid terminal state in MP4 output and add encoded-output regression coverage.
3. Add the project MIT license and explicit Bun runtime metadata/documentation.
4. Publish `0.5.0` only after the consolidation and release validation pass.

## Phase 1: Deterministic Configuration (Completed)

1. Add semantic `OpenCodeConfig` and `OpenCodeTuiConfig` JSON object types.
2. Add `config` and `tui` to script definitions and driver options.
3. Expose mutable `config` and `tui` objects to `setup`.
4. Deep-merge declared configuration over project fixture files, with arrays replacing and setup mutations taking final precedence.
5. Parse existing JSONC rather than assuming strict JSON.
6. Write normalized `.opencode/opencode.jsonc` and `.opencode/tui.jsonc` before creating the optional Git baseline.
7. Verify the same behavior through Effect scripts and the Effect driver.

## Phase 2: Effect Program Runner (Completed)

1. Add `opencode-drive run <module>`.
2. Require a default-exported, fully provided `Effect` value.
3. Typecheck a generated contract entrypoint before importing the program.
4. Execute the program in the CLI's existing Effect runtime, without a nested runtime or detached owner.
5. Reject command flags and arguments after `--`.
6. Make the Effect runner the README quick start.
7. Document minimal, multi-TUI, recording, settlement-failure, and `use` versus `make` examples.

## Phase 3: One Lifecycle Engine (Completed)

1. Make LLM response state independent of one backend connection and attach it per server generation.
2. Introduce an Effect-native server-generation controller over one prepared `OpenCodeInstance`.
3. Add Effect-native named TUI creation, name release, unexpected-exit observation, and relaunch.
4. Reuse the Effect UI implementation directly for `defineScript`, including effectful polling and predicates.
5. Add an internal driver constructor over an already prepared instance.
6. Route `defineScript` backend, UI polling, LLM routing, recording finalization, and TUI ownership through the shared Effect services.
7. Delete duplicated lifecycle implementations only after all characterization tests pass.
8. Replace interruption-sensitive cached terminal operations with shared independently owned settlement effects.

## Phase 4: Structured Run Evidence (Completed)

1. Add a schema-validated `AbsolutePath` branded type.
2. Add a compact `RunReport` containing the artifact root, retention, recordings, and endpoint compatibility.
3. Return reports from safe library settlement without changing ordinary CLI stdout.
4. Publish recordings atomically through temporary files and rename on success.

## Phase 5: Protocol Compatibility (Completed)

1. Add canonical `simulation.handshake` schemas and capability identifiers to OpenCode.
2. Implement the handshake on UI and backend endpoints.
3. Mirror the exact canonical protocol in Drive.
4. Negotiate endpoint role, protocol version, OpenCode version, and required/optional capabilities before exposing operations.
5. Support `required`, `preferred`, and explicit legacy compatibility policies.
6. Fail locally with typed compatibility errors rather than timing out on unsupported operations.
7. Include negotiated or legacy compatibility records in `RunReport`.

## Follow-Ups

### Typed OpenCode SDK

Completed. The driver exposes its generated client as `opencode`, keeps registration credentials internal, and documents that the bundled SDK may differ from arbitrary OpenCode command and development targets.

### Tool Lifecycle Simulation

Extend the canonical OpenCode simulation protocol to model delayed tool completion, structured success, failure, cancellation, concurrency, and partial input. Expose this only through programs, never through convenience CLI command flags.

Drive's plugin-backed runtime controls now cover the supported `shell`,
`webfetch`, and `websearch` adapters. This follow-up remains about canonical,
provider-neutral simulation for arbitrary tools rather than expanding those
Drive-owned adapters.

### Semantic UI Snapshot

Add roles, labels, stable identity, selected/expanded/disabled state, and hierarchy to the canonical OpenCode frontend protocol. Drive should consume those semantics instead of deriving them from terminal text.

## Verification Gates

- Focused unit and integration tests at each phase.
- `bun run check` after each public type or CLI boundary change.
- `bun run test` before each phase commit.
- Real OpenCode v2 capture/configuration smoke test when `OPENCODE_V2_SOURCE` is available.
- Packed-artifact inspection and clean Bun consumer validation before publication.
- Fresh-session skill verification locally, on kitbox, and on the Anomaly agent box.

## Explicit Non-Goals

- Generic terminal automation.
- Noncanonical CLI protocol aliases.
- Backend LLM or tool lifecycle control through shell flags.
- Public raw process, socket, scope, port, registry, or launch-descriptor control.
- Speculative transport/provider plugin systems.
- Automatic retries of state-changing UI operations.
- Campaign or cloud orchestration before the single-run engine is stable.
