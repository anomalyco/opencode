# TUI Package Extraction

## Goal

Move the canonical OpenCode terminal application from
`packages/opencode/src/cli/cmd/tui` into a self-contained workspace package while
the legacy CLI and the new CLI continue to use the same implementation.

Target package:

```text
packages/tui
name: @opencode-ai/tui
```

Target dependency graph:

```text
packages/opencode ---\
                      > @opencode-ai/tui -> @opencode-ai/sdk
packages/cli --------/
```

The TUI may directly depend on terminal and UI infrastructure such as
`@opentui/core`, `@opentui/solid`, `@opentui/keymap`, `solid-js`, Effect, and
generic presentation libraries. It must not depend on `packages/opencode`,
`packages/cli`, or `@opencode-ai/core`.

The SDK is the TUI's OpenCode boundary. Missing backend data or operations must
be added to the server API and generated SDK rather than imported from backend
implementation modules.

## Migration Rules

- Keep one canonical implementation of every TUI feature. Do not copy the full
  TUI into `packages/cli` and synchronize two trees.
- Land each section below independently and commit it before starting the next
  section.
- Keep each intermediate commit buildable and type-safe.
- Continue integrating team changes into whichever location is canonical for a
  file at that point in the migration.
- Use temporary compatibility re-exports only when they materially reduce the
  size or conflict risk of a section. Mark them for removal in a later section.
- Do not preserve private imports by creating aliases from `packages/tui` back
  into `packages/opencode`.
- Do not replace private `packages/opencode` imports with `@opencode-ai/core`
  imports merely to make the package compile.
- Keep tool rendering tolerant of unknown tools and wire-format changes. Local
  checks over `unknown` input and metadata are acceptable; importing backend
  tool implementations for type safety is not.
- Keep legacy CLI command parsing, server startup, worker management,
  authentication, and config discovery outside `@opencode-ai/tui`.

## Ownership Boundary

### `@opencode-ai/tui` Owns

- OpenTUI renderer lifecycle shared by both CLI hosts
- Solid application composition
- Components, routes, dialogs, themes, keymaps, and UI primitives
- SDK client synchronization and event consumption
- Tool-call and tool-result presentation
- TUI-facing plugin contracts and presentation slots
- Resolved TUI configuration types, defaults, and pure validation
- Terminal behavior such as selection, clipboard integration, and local editor
  launching when it is not host-specific
- TUI-local persistence such as prompt history, stash, frecency, selected model,
  and selected theme
- Presentation utilities such as locale formatting, error display, record
  checks, duration formatting, and layout helpers

### CLI Hosts Own

- Command definitions and argument parsing
- Starting, locating, and stopping servers and workers
- Authentication and transport construction
- Process-level signal policy
- Config file discovery, precedence, migration, and environment substitution
- Plugin package discovery, installation, and backend activation
- Upgrade checks and installation metadata
- Executable build wiring and worker path defines

### Server And SDK Own

- OpenCode domain data displayed by the TUI
- Session, message, workspace, file, provider, model, agent, and permission
  operations
- Retry, revert, fork, share, and other backend actions
- Stable wire shapes for tool parts and plugin metadata
- Server capabilities needed to conditionally expose UI behavior

## Current Boundary

The canonical implementation currently lives under:

```text
packages/opencode/src/cli/cmd/tui
```

Its private dependency on `packages/opencode` is primarily expressed through
the `@/*` TypeScript alias, which resolves to `packages/opencode/src/*`.
`@tui/*` imports are internal to the TUI and are not themselves a package
boundary problem.

The main private dependency groups are:

- `@/util/*`: presentation helpers plus filesystem/process/RPC helpers
- `@/tool/*`: backend tool implementations used by renderers
- `@/session/*`, `@/provider/*`, and `@/reference/*`: backend data and actions
- `@/config/*`: config discovery, parsing, variables, and plugin resolution
- `@/plugin/*`: plugin loading and installation
- `@/cli/*`: yargs adapters, network setup, errors, and CLI presentation
- `@/server/*`: authentication and embedded server behavior
- `Global.Path`, `Flag`, and process environment reads

The initial extraction should reduce these dependencies in place before moving
the application root.

## Section 1: Create The Package Skeleton

Status: Completed. The private `@opencode-ai/tui` workspace package now has an
independent OpenTUI Solid JSX configuration, narrow root export, package-local
alias, and in-memory render smoke test. Neither CLI consumes the package yet.

Create `packages/tui` without moving the application root yet.

Tasks:

- Add `packages/tui/package.json` with the name `@opencode-ai/tui`.
- Add a package `tsconfig.json` configured for OpenTUI Solid JSX.
- Add `bunfig.toml` with the OpenTUI Solid preload for package-local development
  and tests.
- Add package scripts for `typecheck` and package-local tests.
- Add direct dependencies used by the TUI. Do not rely on workspace hoisting.
- Add a narrow package export, initially only the package root and any explicit
  testing entrypoint needed by migrated tests.
- Establish a package-local import convention. A local alias such as `@tui/*`
  is acceptable, but it must resolve entirely inside `packages/tui`.
- Add a minimal package entrypoint and smoke test proving OpenTUI Solid TSX can
  typecheck and render.
- Do not make either CLI consume the package yet.

Exit criteria:

- `packages/tui` typechecks independently.
- Its test command runs from `packages/tui`.
- The package has no dependency on `opencode`, `@opencode-ai/cli`, or
  `@opencode-ai/core`.

Checkpoint commit:

```text
feat(tui): add standalone package skeleton
```

## Section 2: Move Presentation Utilities And Leaf UI

Status: Completed. Presentation utilities, bundled themes and their pure theme
engine, keybinding/keymap mechanics, and low-coupling border, link, and spinner
primitives now live in `@opencode-ai/tui`. The legacy host consumes explicit
package exports and retains only integration wrappers or compatibility
re-exports where backend and process concerns have not moved yet.

Move low-coupling code first so subsequent team changes land in the new package
without waiting for the application root migration.

Tasks:

- Move TUI presentation utilities into `packages/tui/src/util`, including the
  portions of locale, error display, record checks, duration formatting, and
  small functional helpers used by TUI code.
- Move pure TUI utilities already under the old TUI directory.
- Move themes and bundled theme JSON files.
- Move UI primitives and leaf components that have no private backend imports.
- Move pure keybinding schemas and keymap helpers that do not read host flags.
- Move related unit and snapshot tests.
- Update remaining old-tree consumers to import the new canonical modules.
- Use temporary compatibility re-exports from old TUI paths only if needed to
  avoid a large unrelated import rewrite.
- Do not move `Filesystem`, `Process`, `Rpc`, worker startup, or config discovery
  as generic utilities in this section.

Exit criteria:

- Moved files have no `@/...` imports.
- Tests for moved code run from `packages/tui`.
- Existing legacy TUI behavior and typecheck remain unchanged.

Checkpoint commit:

```text
refactor(tui): move presentation utilities and primitives
```

## Section 3: Remove Backend Tool Implementation Imports

Status: Completed. Legacy and V2 tool renderers now dispatch on SDK wire names,
accept `Record<string, unknown>` input and metadata, and use local guards for
nested presentation data. Web-search labels and structured metadata extraction
are TUI-owned, unknown tools retain the generic fallback, and no TUI source
imports backend tool implementations. The route components remain in the legacy
tree until the SDK state and route move in Section 6.

Make tool rendering depend only on SDK wire data and local presentation logic.

Tasks:

- Remove imports from `@/tool/*` in TUI routes and feature plugins.
- Key built-in renderers by SDK tool name strings such as `read`, `write`,
  `edit`, `apply_patch`, `grep`, `glob`, `bash`, `question`, and `task`.
- Treat tool input, output metadata, and plugin-defined fields as `unknown` at
  the package boundary.
- Add small local type guards only where a renderer needs a particular field.
- Preserve a generic fallback renderer for unknown and plugin-provided tools.
- Keep renderer failures local: malformed metadata must not crash the entire
  session view.
- Replace backend-derived labels or IDs with TUI-owned presentation constants or
  SDK-provided values.
- Move the affected tool presentation components and tests to `packages/tui`.

Exit criteria:

- No TUI source imports `@/tool/*`.
- Unknown tools render through the generic fallback.
- Existing built-in tool snapshots remain equivalent unless intentionally
  updated and reviewed.

Checkpoint commit:

```text
refactor(tui): decouple tool rendering from backend tools
```

## Section 4: Make Runtime Inputs Explicit

Status: Completed for the shared runtime contract and legacy host. The TUI now
receives immutable launch-directory, path, capability, terminal/editor, startup,
and build inputs through `@opencode-ai/tui/runtime`. Movable app, component,
route, and feature-plugin code no longer reads OpenCode globals or process state;
command, config, plugin-loading, custom-theme discovery, editor/clipboard, and
Windows lifecycle adapters remain host-owned. `packages/cli` does not consume
this contract yet; that integration remains deferred to Section 9.

Replace process-global OpenCode state with resolved TUI inputs.

Define narrow inputs rather than one unstructured host object. Expected groups
include:

```ts
type TuiCapabilities = {
  mouse: boolean
  copyOnSelect: boolean
  terminalTitle: boolean
  workspaces: boolean
  showTimeToFirstDraw: boolean
}

type TuiPaths = {
  home: string
  state: string
  config: string
  data: string
}

type TuiBuildInfo = {
  version: string
  channel?: string
}
```

Tasks:

- Inventory direct reads of `Flag`, `Global.Path`, and relevant environment
  variables in movable TUI code.
- Pass resolved capabilities into the application/provider tree.
- Pass local path roots or a narrow TUI storage capability into persistence
  contexts.
- Pass build/version information explicitly.
- Keep environment reads needed by legacy command or worker startup in
  `packages/opencode` adapters.
- Give `packages/tui` sensible host-neutral defaults only when behavior is truly
  local to a terminal client.
- Move contexts and components after their global dependencies are removed.

Exit criteria:

- Movable TUI code does not import `Flag` or `Global`.
- TUI tests can supply deterministic capabilities and storage paths.
- The legacy host constructs the required input through the public package API;
  the new CLI integration remains deferred to Section 9.

Checkpoint commit:

```text
refactor(tui): make runtime capabilities explicit
```

## Section 5: Separate Resolved TUI Config From Host Config Loading

Status: Completed for the package config contract and legacy host adapter.
`@opencode-ai/tui/config` now owns schemas, defaults, keybind resolution, the
resolved config type, and the Solid config provider. The legacy host retains
file discovery, precedence, JSONC parsing, substitutions, migration,
source-relative sound paths, plugin origins, dependency installation, and
Effect services. `packages/cli` remains untouched until Section 9.

Move config semantics needed by rendering while retaining filesystem discovery
and migration in the legacy host.

Tasks:

- Move TUI config schemas, keybind schemas, defaults, and pure resolution to
  `packages/tui`.
- Define the resolved config accepted by the public TUI entrypoint.
- Keep config path discovery, project/global precedence, migration, variable
  expansion, and plugin package installation in `packages/opencode` initially.
- Make the legacy host produce the same resolved config shape.
- Add a new CLI adapter that can initially provide defaults or its own resolved
  configuration.
- Update schema-generation imports to use the package's explicit config export
  if schema generation still needs TUI schemas.
- Move pure config tests; retain discovery and migration integration tests in
  `packages/opencode`.

Exit criteria:

- `packages/tui` does not import `@/config/*`.
- Config discovery can change without changing TUI rendering code.
- The old CLI still honors existing config precedence and migration behavior.

Checkpoint commit:

```text
refactor(tui): separate config resolution from loading
```

## Section 6: Move SDK State, Routes, And Backend Operations

Status: Completed for the SDK/domain boundary. SDK, project, event, legacy sync,
V2 sync, local model state, prompt persistence, and pure prompt helpers are now
canonical in `@opencode-ai/tui`. Configured references resolve through the new
generated `reference.list` SDK operation; prompt payloads rely on optional
server-assigned IDs; local attachment reads use the package platform contract.
Legacy route files remain in place until the plugin slot boundary and app-root
move, but their only private dependencies are plugin presentation or local host
adapters rather than OpenCode domain implementations.

Make the SDK the only OpenCode domain boundary used by the TUI.

Tasks:

- Move SDK client providers, event synchronization, routes, prompt UI, and
  session views into `packages/tui`.
- Replace direct imports from `@/session/*`, `@/provider/*`, `@/reference/*`,
  `@/lsp/*`, and other backend domains with SDK data or TUI-owned presentation
  helpers.
- Replace direct backend actions such as retry with SDK calls.
- For each missing operation, add or adjust the server endpoint, regenerate the
  JavaScript SDK with `./packages/sdk/js/script/build.ts`, and consume the
  generated SDK API.
- Keep transport creation outside the package. Accept a base URL, headers,
  custom fetch, event source, or constructed SDK client as appropriate.
- Keep local-only UI state in the TUI package rather than adding it to the
  server API.
- Move affected tests and fixtures. Use real SDK/server integration where
  practical instead of mocking backend modules.

Exit criteria:

- Domain-facing TUI code imports OpenCode data and operations only from
  `@opencode-ai/sdk`.
- No TUI source imports private session, provider, reference, LSP, server, or
  core domain implementations.
- SDK generation is clean after any API changes.

Checkpoint strategy:

This section may be split into multiple commits when an SDK gap is substantial.
Each commit must leave both the old TUI host and package tests working. Suggested
commit pattern:

```text
feat(sdk): expose <operation> for tui clients
refactor(tui): move <area> to sdk boundary
```

Final section checkpoint:

```text
refactor(tui): move sdk state and routes into package
```

## Section 7: Isolate Plugin Presentation From Plugin Loading

Status: Completed. Plugin slots, route registration, TUI-facing APIs, runtime
presentation state, and built-in feature plugins now live in
`@opencode-ai/tui`. The legacy host injects a narrow plugin host that retains
discovery, installation, manifest/config mutation, external module execution,
pure-mode filtering, and cleanup ownership. Missing or failing plugin hosts
degrade to the base TUI without blocking startup.

Keep plugin UI extensibility without importing the legacy plugin installer and
loader into the TUI package.

Tasks:

- Move plugin presentation slots, route contracts, and TUI-facing APIs into
  `packages/tui` or the existing public plugin TUI contract package.
- Keep package discovery, installation, manifest resolution, backend activation,
  and process lifecycle in the host.
- Define the serialized or runtime plugin presentation data the TUI requires.
- Prefer SDK-delivered plugin metadata when the behavior must also work for a
  remote server.
- Make plugin absence or incompatibility degrade gracefully.
- Move plugin rendering tests to `packages/tui`; retain installation/loading
  integration tests in `packages/opencode`.

Exit criteria:

- `packages/tui` does not import `@/plugin/*` or the old TUI plugin runtime.
- Remote and local TUI clients have a defined plugin behavior.
- Plugin UI failures cannot prevent the base TUI from starting.

Checkpoint commit:

```text
refactor(tui): separate plugin presentation from loading
```

## Section 8: Move The Application Root And Renderer Lifecycle

Status: Completed. `packages/tui` now owns the canonical application root,
provider composition, routes, components, parser presentation, renderer
configuration, and renderer lifecycle. Process mutation, Windows console
handling, backend worker startup, config loading, plugin loading, native audio,
and legacy platform implementations remain injected host adapters. Old source
paths are temporary compatibility re-exports for the legacy command host.

Move the canonical app composition after its dependencies have already crossed
the package boundary.

Tasks:

- Move `app.tsx`, remaining providers, routes, components, attention handling,
  keymaps, and renderer lifecycle to `packages/tui`.
- Export a narrow public API such as:

```ts
export type TuiInput = {
  url: string
  directory?: string
  headers?: RequestInit["headers"]
  fetch?: typeof fetch
  config: TuiConfig.Resolved
  capabilities: TuiCapabilities
  paths: TuiPaths
}

export function run(input: TuiInput): TuiHandle
export function createRenderer(config: TuiConfig.Resolved): Promise<CliRenderer>
```

- Preserve the existing lifecycle guarantees: readiness, waiting until exit,
  idempotent cleanup, renderer destruction, SIGHUP handling where appropriate,
  and terminal restoration.
- Keep Windows process adapters outside the package if they mutate host process
  state; invoke them from CLI adapters around the package lifecycle.
- Keep OpenTUI parser-worker embedding in executable build scripts.
- Move app lifecycle and rendering tests to `packages/tui`.

Exit criteria:

- `packages/tui` contains the canonical application root.
- The package has no imports from `packages/opencode`, `packages/cli`, or
  `@opencode-ai/core`.
- The package public API is sufficient for both old and new CLI adapters.

Checkpoint commit:

```text
refactor(tui): move application root into package
```

## Section 9: Convert Both CLIs To Thin Adapters

Status: Completed. The legacy thread and attach commands now lazily invoke the
public `@opencode-ai/tui` root while retaining worker/server/config/plugin and
process adapters. The new CLI default command launches the same package against
its authenticated daemon transport with a minimal local platform/host. Missing
legacy provider/config APIs currently degrade to the shared provider-connect
screen; source and compiled new-CLI behavior match, while named commands remain
outside the TUI path.

Make both executable packages consume the same TUI package.

Tasks:

- Keep the legacy yargs commands corresponding to current `thread.ts` and
  `attach.ts` in `packages/opencode`.
- Keep the legacy embedded worker and server startup in `packages/opencode`.
- Change those adapters to load config, create transport inputs, and call the
  public `@opencode-ai/tui` API.
- Change `packages/cli`'s default command handler to call the same public API.
- Remove the temporary `packages/cli/src/tui` shell after the shared package is
  integrated.
- Remove duplicated OpenTUI lifecycle code from both hosts.
- Ensure non-TUI subcommands remain lazily isolated from OpenTUI startup.
- Update executable build scripts to bundle the shared package, parser worker,
  assets, and any retained host worker.

Exit criteria:

- Both CLIs launch the same package implementation.
- There is no duplicate TUI source tree in `packages/cli`.
- Legacy attach and local-worker modes still work.
- Named non-TUI commands do not launch or eagerly initialize the TUI.

Checkpoint commit:

```text
refactor(cli): share tui package across command hosts
```

## Section 10: Remove Compatibility Paths And Finish Ownership

Status: Completed. Package source imports are self-contained, package exports
are narrowed to active host contracts, package-owned tests and snapshots live
under `packages/tui`, and the obsolete compatibility tree has been removed.
Legacy command, worker, config, plugin-loader, process, editor, audio, and event
adapters now live in explicit host-owned locations outside `src/cli/cmd/tui/`.

Delete migration scaffolding only after both hosts consume the package.

Tasks:

- Remove old TUI compatibility re-exports and the obsolete directory tree under
  `packages/opencode/src/cli/cmd/tui`.
- Retain and relocate only true host adapters such as legacy commands, worker,
  transport setup, and config loading.
- Remove obsolete `@tui/*` path mappings from `packages/opencode`.
- Remove stale test fixtures and update all imports to package exports.
- Narrow `@opencode-ai/tui` exports to intentional public entrypoints.
- Verify package manifests list every direct dependency and no accidental
  dependency is supplied only by workspace hoisting.
- Update repository documentation describing TUI ownership and development.

Exit criteria:

- No production import references the old TUI source location.
- No source under `packages/tui` imports `@/...`, `@opencode-ai/core`, or either
  executable package.
- The old TUI directory contains no canonical implementation files.
- The dependency graph has no cycle.

Checkpoint commit:

```text
refactor(tui): complete standalone package extraction
```

## Invariants To Preserve

- There is one canonical TUI implementation at every migration stage.
- Legacy TUI behavior remains available until its host is intentionally removed.
- The default new CLI command launches the TUI, while named subcommands continue
  to route to their own handlers.
- Renderer cleanup restores the terminal on normal exit, interruption, startup
  failure, and renderer destruction.
- TUI package imports do not reach into executable or backend implementation
  packages.
- SDK wire data is treated as the source of truth for OpenCode domain state.
- Unknown tools and plugin data render safely without backend type imports.
- Remote-server use remains possible; the TUI must not require an in-process
  backend implementation.
- TUI-local persistence remains local and does not become server state unless
  there is an explicit product requirement.
- Team changes should be moved with their canonical file, not manually copied
  between old and new implementations.

## Verification Gates

Run verification after every section, adding narrower tests for the area being
moved.

Package checks:

```text
cd packages/tui && bun typecheck
cd packages/tui && bun test
cd packages/opencode && bun typecheck
cd packages/cli && bun typecheck
```

Dependency checks:

```text
rg "from ['\"]@/" packages/tui/src
rg '@opencode-ai/core|packages/opencode|packages/cli' packages/tui
rg 'src/cli/cmd/tui|@tui/' packages/opencode/src packages/opencode/test
```

SDK checks when server APIs change:

```text
./packages/sdk/js/script/build.ts
git diff --check
```

Interactive smoke checks should run in `tmux` so the terminal can be captured
and cleaned up reliably:

- Start the legacy local TUI and confirm initial render.
- Start legacy attach mode against a server.
- Start the new CLI default command and confirm it renders the same package.
- Exit each mode with Ctrl-C and verify the process and terminal are restored.
- Run representative named commands in both CLIs and verify they do not launch
  the TUI.

Compiled checks:

- Build the current-platform `packages/opencode` binary.
- Build the current-platform `packages/cli` binary.
- Run TUI and non-TUI smoke checks against both compiled binaries.
- Verify theme JSON, audio assets, OpenTUI parser worker, and retained backend
  worker assets are included.

## Progress Tracking

- [x] Section 1: Create the package skeleton
- [x] Section 2: Move presentation utilities and leaf UI
- [x] Section 3: Remove backend tool implementation imports
- [x] Section 4: Make runtime inputs explicit
- [x] Section 5: Separate resolved TUI config from host config loading
- [x] Section 6: Move SDK state, routes, and backend operations
- [x] Section 7: Isolate plugin presentation from plugin loading
- [x] Section 8: Move the application root and renderer lifecycle
- [x] Section 9: Convert both CLIs to thin adapters
- [x] Section 10: Remove compatibility paths and finish ownership

Update each section's status and this checklist in the same commit that completes
the section.
