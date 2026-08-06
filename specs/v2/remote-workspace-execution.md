# Hosted Workspace Execution

Status: superseded by `specs/v2/workspaces.md` for domain model and public API. Retained for execution-level research: provider feasibility gates, process laws, host-authority tripwires, and phase acceptance criteria. Where the two documents disagree (repository-at-creation, required Project identity, placement as a public concept, narrow process contract), `workspaces.md` wins.

Reader: the engineer implementing provider-neutral hosted Workspaces in OpenCode V2.

After reading this plan, that engineer can implement the smallest complete hosted coding slice in order, without moving the Session runner into a sandbox, leaking sandbox-driver details into Session APIs, or accidentally using the OpenCode server filesystem.

## The Runner Stays Central And Hosted Authority Enters Through Location

OpenCode will keep the Session runner in the central server. A Session with an explicit `Location.workspaceID` receives one hosted `WorkspaceEnvironment` when its Location graph is built.

```text
SessionExecution.resume(sessionID)
  -> SessionStore.get(sessionID)
  -> LocationServiceMap.get(session.location)
  -> HostedWorkspaceStore.get(location.workspaceID)
  -> SandboxDriver.acquire(persisted binding)
  -> build hosted Location services
  -> SessionRunner.run(sessionID)
```

The central server continues to own model calls, permissions, tool definitions, durable Session history, output limits, and tool settlement. Only Workspace file and foreground-process effects cross the sandbox-driver boundary.

An omitted `Location.workspaceID` continues through the current implicit-local graph. The first implementation does not rebuild local filesystem or process services behind the hosted interfaces.

The first milestone is an internal execution tracer, not a public Workspace product API. It connects to a pre-provisioned hosted resource, runs one real V2 Session, and reconnects after OpenCode rebuilds its Location graph. Public provisioning and lifecycle APIs follow only after the execution boundary works.

## One Concrete Scenario Defines The First Milestone

The milestone is complete when this scenario passes against a deterministic fake and the sandbox provider selected by Phase 0:

1. Register a pre-provisioned hosted resource containing a fixture Git repository.
2. Create a V2 Session whose Location references that hosted Workspace.
3. Confirm the provider directory does not exist on the OpenCode server host.
4. Prompt the Session to read and edit a file.
5. Run `git status` and one foreground shell command in the hosted checkout.
6. Interrupt a long command and confirm the provider command terminates.
7. Evict and rebuild the Location graph.
8. Reconnect to the same provider resource and verify the edit remains.
9. Run the existing implicit-local Session path without behavior changes.

The first milestone deliberately omits public create, deactivate, reactivate, and delete operations. The test fixture owns provider cleanup.

## Vocabulary Is Stable Across Core And Drivers

### Hosted Workspace

A Hosted Workspace is a stable writable checkout identified by `Workspace.ID`. A Session references it only through `Location.workspaceID`.

The Hosted Workspace record stores private placement and project metadata. It does not copy or synchronize files. The provider filesystem is authoritative.

### Workspace Root

The Workspace root is the checkout root. It is an absolute POSIX path in the provider filesystem, not a path on the OpenCode server.

The first milestone supports one checkout root per Hosted Workspace. Do not add a separate project root until a concrete multi-root layout requires one.

### Location Directory

The Location directory is the Session working directory inside the Workspace root. It may equal the root or name a nested directory. It uses the provider POSIX namespace.

`Location.Ref.directory` remains required. Core validates a hosted directory with POSIX path rules and never passes it to Node, Bun, native search, native watcher, or host Git APIs.

### Placement

Placement is the private durable fact that names the sandbox driver and provider resource for one Hosted Workspace.

Placement contains:

- `Workspace.ID`;
- the sandbox-driver key;
- a placement format version;
- a provider-validated JSON binding;
- the Workspace root;
- the logical Project ID;
- optional VCS metadata already discovered inside the provider resource.

Provider credentials, SDK clients, preview URLs, process handles, and model-provider credentials are never placement data.

### Binding

A binding is the smallest provider-specific JSON value required to reconnect to the same provider resource. Each sandbox driver owns an Effect Schema for its binding.

The first contract requires a stable binding. `acquire` cannot replace it or silently create another resource. Providers whose durable identity changes during activation require a later transactional binding-transition design.

### Sandbox Driver

A sandbox driver is an internal adapter for one hosted-environment provider. “Provider” without the “sandbox” qualifier remains reserved for model providers in user-facing APIs.

### WorkspaceEnvironment

`WorkspaceEnvironment` is the scoped live data-plane connection for one Hosted Workspace. Closing its scope releases local SDK and stream resources and cleans up scope-owned foreground commands. It never stops, snapshots, or deletes the durable provider resource.

## Placement Reconnects Without Acquiring Compute

V2 must read Hosted Workspace metadata without contacting a sandbox provider. This lets Session lists, routing, and Location validation remain cheap and available while provider compute is stopped or unavailable.

Add a V2-owned internal table rather than overloading the V1-owned `workspace.type` and `workspace.extra` columns:

```text
hosted_workspace
  id             primary key, Workspace.ID
  driver         sandbox-driver key
  version        placement encoding version
  root           provider POSIX Workspace root
  project_id     logical Project ID
  vcs            optional VCS kind
  binding        provider-validated JSON
  time_created
  time_updated
```

No V2 placement format has shipped, so the first migration has no compatibility decoder. The implementation does not add rows to the shared V1 `workspace` table and does not modify `packages/opencode`.

Hosted registration transactionally rejects an ID already present in the V1 `workspace` table. Session projection identifies hosted IDs through `hosted_workspace` and skips the legacy `WorkspaceTable.time_used` update for them. Hosted execution never inserts, updates, or deletes a V1 Workspace row.

The current Session schema requires `project_id` to reference `ProjectTable`. Registration therefore ensures a Project row exists. If no local checkout exists, its current `worktree` column temporarily contains the provider POSIX root. If the logical Project already has a local row, registration preserves its local `worktree` rather than overwriting it. V2 hosted code must never interpret a provider root through host filesystem services. This is an acknowledged shared-schema limitation, not a declaration that provider and host absolute paths share a namespace.

A later Project persistence redesign may separate logical Project identity from checkout locations. That redesign is not required to prove hosted execution.

## Hosted Session Admission Must Bypass Host Project Discovery

Current `SessionV2.create` always calls host-backed `Project.resolve(input.location.directory)` and computes the Session path with host `path.relative`. Hosted Session admission must branch before either operation.

```text
workspaceID omitted
  -> current Project.resolve and host path behavior

workspaceID present
  -> HostedWorkspaceStore.get(workspaceID)
  -> validate Location directory inside Workspace root with path.posix
  -> ensure ProjectTable row from persisted logical project metadata
  -> compute Session path with path.posix.relative
  -> persist the existing Location.Ref and project ID
```

Hosted registration supplies project identity before Session creation. The first Vercel fixture discovers it by running Git inside the sandbox. Session admission does not wake compute merely to rediscover it.

Tests place tripwires on `Project.resolve`, host Git, and host filesystem services and assert that hosted Session creation calls none of them.

Path-bearing Session operations outside the Location graph need explicit guards too:

- `Session.move` rejects when either the current or requested Location has `workspaceID`, before path expansion, host filesystem access, or `Project.resolve`;
- hosted prompts accept inline `data:` attachments but reject `file:` attachments before prompt materialization;
- provider-file attachments and hosted Session movement require later `WorkspaceFiles` designs.

## The Hosted Graph Replaces Every Reachable Host Authority

The current Location graph statically includes services that ultimately use host filesystem, process, native search, watcher, PTY, snapshots, project copies, plugins, and configuration. Replacing only `FSUtil` or only `AppProcess` is unsafe:

- replacing all `FSUtil` would redirect host-owned config and managed outputs into the sandbox;
- retaining global `FSUtil` would read project files from the server host;
- retaining current plugin loading could import Workspace modules into the central process;
- retaining PTY, watcher, FFF, snapshot, or project-copy services would act on provider paths as if they were host paths.

The hosted branch therefore supplies dedicated implementations for the services it supports and explicit rejecting implementations for the rest.

### Host-Owned Services

These remain process-global and continue using host storage:

- database and durable event storage;
- global OpenCode configuration;
- credentials and auth stores;
- caches and downloaded assets;
- managed tool output storage;
- model and sandbox-driver credentials;
- built-in and global skills;
- remote URL instruction fetching.

### Workspace-Owned Services In The First Milestone

These use `WorkspaceEnvironment`:

- `Location` metadata;
- one hosted read path;
- one hosted exact-edit path;
- hosted `AGENTS.md` discovery needed by initial System Context;
- a hosted foreground Bash implementation;
- request-driven `git status` through Bash;
- hosted environment facts.

### Hosted Capability Table

| State | Capabilities |
| --- | --- |
| Advertised | read, exact edit, foreground Bash |
| Endpoint remains but returns `UnsupportedWorkspaceCapability` | Session move, `file:` prompt attachments, PTY, project copies, snapshots/revert |
| Not advertised and local producer is not activated | external file paths, apply-patch, glob, grep, project config, project skills, project plugins, application tools, FFF, watcher, LSP, full `Git.Service` |

The first milestone narrows the tool catalog for hosted Sessions. It must not advertise a tool whose execution would fall back to host authority.

Some current service interfaces and Protocol endpoints cannot represent “unsupported” as a typed result. The hosted graph work must add a sanitized `UnsupportedWorkspaceCapability` error where needed; carry placement and acquisition errors through `LocationServiceMap`, `SessionExecution.resume`, `SessionRunner.RunError`, Session error mapping, and HTTP middleware; and remove any `Layer.orDie` that would convert expected hosted availability errors into defects. Public `HttpApi` changes require client regeneration.

## WorkspaceEnvironment Is A Small Data-Plane Interface

```ts
interface WorkspaceEnvironment {
  readonly platform: "linux"
  readonly root: string
  readonly files: WorkspaceFiles
  readonly processes: WorkspaceProcesses
  readonly shell: {
    readonly executable: string
    readonly args: (command: string) => readonly string[]
    readonly environment: Readonly<Record<string, string>>
  }
}
```

The environment does not expose driver keys, provider resource IDs, bindings, lifecycle methods, preview URLs, or an untyped `raw` escape hatch.

The first environment has no general capability map. Hosted graph construction knows the milestone's fixed supported set. Add capability negotiation only after two real drivers expose a difference a caller must handle dynamically.

## File Operations Preserve Current Cooperative Mutation Semantics

Provider file operations receive normalized Workspace-relative POSIX paths. Core never sends host absolute paths across this boundary.

```ts
interface WorkspaceFiles {
  readonly resolve: (
    path: WorkspacePath,
  ) => Effect.Effect<ResolvedWorkspacePath, WorkspaceFileError>

  readonly read: (
    path: WorkspacePath,
  ) => Effect.Effect<Uint8Array, WorkspaceFileError>

  readonly writeIfUnchanged: (
    path: WorkspacePath,
    expected: Uint8Array,
    content: Uint8Array,
  ) => Effect.Effect<void, WorkspaceFileError | StaleContentError>
}
```

`WorkspacePath` is relative, slash-separated, and cannot escape with `..`. `ResolvedWorkspacePath` returns a canonical Workspace-relative identity for permission resources and OpenCode mutation locking.

Path normalization has one implementation:

1. Reject an absolute model-facing file path.
2. Resolve the relative input against the absolute provider Location directory with `path.posix`.
3. Verify lexical containment within the Workspace root.
4. Convert the result to a normalized Workspace-root-relative `WorkspacePath`.
5. Ask the driver to resolve symlinks and return the canonical Workspace-relative identity used for permissions and mutation locking.

The driver validates lexical containment and resolves symlinks at operation time. Under the assumed provider-isolation model, a path escape remains inside the provider environment rather than reaching the OpenCode host. The milestone does not validate the provider's isolation boundary or claim race-free containment against a concurrently malicious shell process inside the same sandbox.

`writeIfUnchanged` means OpenCode-coordinated conditional replacement:

- one driver call compares expected bytes and replaces the target;
- the fake serializes this operation with other `WorkspaceFiles` mutations;
- the Vercel implementation uses one provider-side helper invocation and same-filesystem atomic replacement where available;
- unrelated shell or external provider mutations may still race because provider filesystems expose no general CAS primitive.

This matches the first milestone's single mutating Session and no-background-command scope. Do not describe it as a global filesystem transaction.

The Vercel feasibility tracer decides whether direct SDK methods are sufficient or whether all supported file operations need a versioned helper installed in the sandbox image.

## Foreground Commands Use A Narrow Contract Instead Of ChildProcessSpawner

Effect's `ChildProcessSpawner` requires stdin, additional file descriptors, `unref`, PID semantics, combined streams, and other behavior the researched provider adapters do not prove. It also cannot see `AppProcess.RunOptions.timeout`, so adapting only the spawner cannot forward provider-native deadlines.

Define a hosted foreground-command contract at the level the first tools need:

```ts
interface WorkspaceProcesses {
  readonly start: (
    input: ForegroundCommand,
  ) => Effect.Effect<WorkspaceProcess, WorkspaceProcessError, Scope.Scope>
}

interface ForegroundCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: WorkspacePath
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

interface WorkspaceProcess {
  readonly stdout: Stream.Stream<Uint8Array, WorkspaceProcessError>
  readonly stderr: Stream.Stream<Uint8Array, WorkspaceProcessError>
  readonly exit: Effect.Effect<ProcessExit, WorkspaceProcessError>
  readonly terminateAndConfirm: Effect.Effect<void, UnconfirmedProcessTermination>
}
```

Hosted Bash and hosted Git-status execution use this service directly. Register a distinct hosted Bash tool implementation in the hosted-safe tool bootstrap; do not reuse the current host-assuming Bash layer. Local Bash remains on the current `AppProcess` path.

Process laws:

- a pre-interrupted call creates no provider command;
- command and argv remain distinct from shell-string lowering;
- non-zero exit is a terminal process result;
- each output channel preserves provider order;
- `exit` settles once and supports multiple waiters;
- timeout is forwarded to the provider before a central deadline is used as a backstop;
- explicit cancellation runs `terminateAndConfirm` uninterruptibly with its own bounded confirmation deadline;
- the selected driver uses the kill-and-confirm sequence proven in Phase 0, with a fresh bounded confirmation signal rather than the caller's aborted signal;
- scope finalization performs best-effort cleanup and logs failures, because Effect finalizers cannot return a typed error;
- process handles are not reconnectable after an OpenCode restart.

The first contract has no stdin, background mode, PTY, provider PID exposure, or combined-output ordering guarantee. Hosted Bash renders stdout and stderr honestly rather than inventing interleaving.

Provider start has a bounded deadline. Use an interruptible checkpoint before one uninterruptible provider-start and finalizer-registration region. Interruption before the checkpoint makes zero provider calls. Once a handle is returned, cleanup is registered exactly once. A transport failure before the provider returns a handle is an indeterminate-start error and is never retried automatically.

The process scope and `WorkspaceEnvironment` scope remain open until streams and terminal settlement finish. Follow one explicit stream shape: `Stream.unwrap` acquires the environment and process in the stream execution scope, drains required channels there, and runs process cleanup before environment release.

## Effect Scopes Own Connections, Not Provider Lifecycle

Each cached hosted Location acquires its own `WorkspaceEnvironment`. Sharing one environment across simultaneous Location directories in the same Workspace is deferred, so the first milestone does not need a second keyed `WorkspaceEnvironmentMap`.

`LocationServiceMap` already owns a scoped, cached Location layer. The hosted Location layer acquires its `WorkspaceEnvironment` directly:

```ts
Layer.effect(
  WorkspaceEnvironment.Service,
  driver.acquire(binding),
)
```

The driver implements `acquire` once with scoped acquisition and best-effort release. Do not wrap a scoped `acquire` in a second `Effect.acquireRelease`, and do not add `RcMap`, `RcRef`, manual connection counters, or a second idle TTL.

The existing Location TTL therefore also retains the provider handle. This is acceptable for the tracer and must be tested with `TestClock`. Releasing it may be a no-op for stateless SDK objects. It never stops or deletes provider compute.

Introduce keyed environment sharing only when simultaneous Locations need to share a provider handle.

## Errors Describe Distinct Recovery Actions

Start with this Core boundary:

- `WorkspaceNotFound`: registration or placement is absent;
- `WorkspaceUnavailable`: binding decode, credentials, provider outage, missing resource, or acquire failure, with a sanitized category;
- `WorkspaceFileError`: hosted file operation failed;
- `WorkspaceProcessError`: hosted foreground process failed;
- `UnsupportedWorkspaceCapability`: the hosted graph intentionally does not provide an operation;
- `UnconfirmedProcessTermination`: explicit cancellation could not prove the command stopped.

Use `Schema.TaggedErrorClass` for domain errors. Preserve existing tool-facing failure shapes where callers do not need a new distinction. Do not add `WorkspaceDeleted` without a durable tombstone.

## Vercel Is Provisional Until Three Feasibility Gates Pass

Vercel is the provisional first driver because its named persistent sandbox, detached command handle, output logs, timeout, `kill`, `wait`, stop, and delete APIs appear closest to the required slice.

Before production contracts land, a disposable provider-only tracer must prove:

1. **Rooted file behavior:** read and conditional replace reject lexical and symlink escape with the chosen direct-SDK or helper design.
2. **Stable retained identity:** exact-name get reconnects to the same persistent resource without `getOrCreate` silently replacing it.
3. **Confirmed termination:** kill followed by a fresh bounded wait proves the command stopped; a sentinel command cannot mutate after cancellation reports success.

The tracer must also establish the versioned sandbox image or bootstrap containing `git`, the selected shell, and any file helper. Required tools are provisioned, not discovered opportunistically.

For retained Vercel resources, explicitly evaluate persistent mode, non-expiring snapshot policy, retained-snapshot count, billing, and storage behavior. Persist the exact provider resource name in the binding. Do not infer durable retention from SDK defaults.

If Vercel fails a gate, compare Daytona on the same gates before choosing the first driver. Do not weaken the common contract to preserve the initial choice.

## Implementation Proceeds In Mergeable Phases

Each phase contains small commits and its own acceptance criteria. A phase may span packages; a commit should not combine storage, graph wiring, a provider adapter, and end-to-end behavior.

### Phase 0: Prove Provider Feasibility Outside Production Core

Create a disposable tracer, then remove it or retain only a focused test fixture.

Commits or experiments:

1. Prove exact-name create/get/reconnect and persistence configuration.
2. Prove the rooted read/conditional-replace design.
3. Prove detached stdout/stderr plus kill-and-confirm.
4. Record image/bootstrap requirements and SDK versions.

Acceptance:

- all three feasibility gates pass against one provider;
- no production Core contract depends on an unproven SDK behavior;
- observed behavior and provider configuration are recorded in this document.

### Phase 1: Persist Placement And Admit Hosted Sessions Without Host I/O

Commits:

1. Add the internal Hosted Workspace schema/table and store.
2. Add the sandbox-driver binding decoder registry without SDK implementations.
3. Add internal registration for a pre-provisioned fake resource.
4. Add the hosted branch to `SessionV2.create` using `path.posix` and persisted Project metadata.
5. Add hosted metadata resolution without constructing a runnable Location graph.

Hosted registration and admission remain internal test-only operations until Phase 2 installs the runnable hosted graph in production composition. No merged production server may admit a durable Session it cannot resume.

Acceptance:

- registration and Session creation make zero driver acquire calls;
- a hosted Session can be recorded when the provider directory is absent from the host;
- hosted Session creation calls no host `Project.resolve`, Git, or filesystem service;
- unknown Workspace, unknown driver, malformed binding, and out-of-root Location directory fail with typed errors;
- registration rejects a V1 Workspace ID collision;
- hosted Session creation performs no mutation against the V1 `workspace` table;
- the implicit-local Session creation tests remain unchanged;
- no row is added to the V1 `workspace` table.

### Phase 2: Build A Host-Safe Read-Only Location Graph

Commits:

1. Add `WorkspaceEnvironment`, `WorkspaceFiles.read`, and the minimal fake driver.
2. Make `buildLocationServiceMap` select local or hosted graph construction.
3. Add hosted `Location`, read, and environment-fact services.
4. Split instruction production: host-global discovery reads only host-global sources, while hosted upward `AGENTS.md` discovery reads through `WorkspaceFiles`; Session instruction composition combines both.
5. Add a hosted Config projection that retains only approved host-owned model, provider, agent, permission, and built-in/global-skill inputs. It emits no plugin-discovery directories and removes plugin, MCP, command, reference, formatter, LSP, watcher, shell, and snapshot configuration.
6. Add hosted plugin/tool bootstrap that does not call the standard local `PluginInternal.list` or `PluginSupervisor` scan path.
7. Add rejecting implementations and Protocol errors for every endpoint retained by the Hosted Capability Table.
8. Materialize an explicit allowlist containing only the central model setup and hosted read tool.

Acceptance:

- the real Session runner completes a read-only hosted Session against the fake;
- graph boot and read operations trigger host-access tripwires zero times;
- configured global plugins, MCP servers, commands, references, and local tools are neither imported nor advertised for a hosted Location, while remaining active for implicit-local Locations;
- hosted move and `file:` attachment requests fail before host path expansion and trigger host tripwires zero times;
- capabilities follow the Hosted Capability Table;
- expected placement/acquire failures do not become defects;
- Location eviction releases the fake environment but performs no lifecycle operation;
- `TestClock` verifies the current Location TTL behavior;
- implicit-local graph tests remain unchanged.

### Phase 3: Add One Cooperative Exact-Edit Path

Commits:

1. Add `WorkspaceFiles.resolve` and `writeIfUnchanged` to the fake.
2. Add hosted mutation path and permission-resource derivation.
3. Add hosted exact-edit materialization.
4. Add deterministic stale-content and symlink tests.

Acceptance:

- exact edit changes only fake provider storage;
- lexical escape and operation-time symlink escape fail;
- competing `WorkspaceFiles` conditional writes produce one winner and one stale failure;
- unrelated shell races remain explicitly outside the guarantee;
- external hosted file paths are unsupported;
- local edit behavior remains unchanged.

### Phase 4: Add Foreground Bash And Git Status

Commits:

1. Add the fake `WorkspaceProcesses` implementation with deterministic barriers.
2. Add hosted Bash over the narrow process contract.
3. Add hosted authority descriptions and environment allowlisting.
4. Add request-driven `git status` fixture coverage.

Acceptance:

- the driver receives the requested timeout;
- stdout and stderr preserve per-channel order;
- non-zero exit settles normally;
- interruption confirms provider termination before the tool settles;
- abort before start creates no provider command;
- kill refusal returns `UnconfirmedProcessTermination` and logs one orphan diagnostic;
- a later command succeeds after timeout or interruption;
- OpenCode forwards only the explicit environment allowlist and no model or sandbox-driver credentials; provider-injected variables are recorded separately;
- `git status` observes the hosted edit;
- local Bash behavior remains unchanged.

### Phase 5: Prove The Complete Fake Session

Commits:

1. Add one end-to-end Session fixture using the real runner, permissions, tools, and durable settlement.
2. Add Location eviction and reconstruction around the same fake provider resource.

Acceptance:

- the concrete milestone scenario passes through exact edit and Bash;
- each tool call in the fixture produces one terminal durable settlement;
- interrupted process cleanup completes before environment release;
- rebuilding the Location graph reconnects to the same fake resource;
- this phase claims cache/graph reconstruction, not a process restart, because fake state is in memory.

### Phase 6: Add The First Real Sandbox Driver

Commits:

1. Add a lazy driver-loader thunk keyed by the selected sandbox driver.
2. Add the provider binding schema and acquire-only adapter.
3. Add the rooted file implementation chosen in Phase 0.
4. Add foreground process streaming, timeout, and kill confirmation.
5. Provide the selected driver registry from Server composition without loading its SDK on the local-only path.
6. Register a pre-provisioned real-provider binding through the internal registration path.
7. Add credential-gated live contract tests.
8. Add a true second-process restart test that reconstructs placement from SQLite.

Acceptance:

- the complete milestone scenario passes against the real provider;
- a second OpenCode process reconnects to the same resource and reads the edit;
- reconnect returns the same recorded provider identity and `acquire` never invokes create or get-or-create;
- interruption is confirmed with a post-cancel sentinel test;
- OpenCode forwards no model credentials, sandbox-driver credentials, or ambient host environment variables; provider-injected variables are recorded separately;
- implicit-local startup does not evaluate the provider SDK module;
- required live tests run in hosted-feature release validation, not only developer machines.

Result: the first hosted execution milestone is complete.

## Lifecycle Requires A Separate Reviewed Plan

Lifecycle is not part of the execution tracer. Effect `LayerMap.invalidate` does not wait for active references and is not a lifecycle fence.

A follow-up plan must design one shared gate for Session creation, Location lease admission, deactivate, reactivate, and delete; durable transition and retry rules; and explicit behavior for historical Sessions after deletion. Do not expose lifecycle publicly until that gate, authorization, Protocol errors, Server handlers, and generated clients are reviewed together.

## Broader Tools And A Second Driver Follow The Tracer

After the first real hosted Session works, broaden the hosted graph in this order:

1. apply-patch over the established mutation contract;
2. provider-provisioned `rg` and `find`, then glob and grep;
3. data-only project configuration with an explicit field allowlist;
4. project skills;
5. stdin and the required subset of `Git.Service`;
6. a second driver selected to pressure-test the established contract.

Daytona is the likely second driver when Vercel passes Phase 0. It would pressure-test exact resource reconnect, stop/start retention, whole-second timeout rounding, command-session termination confirmation, and current SDK behavior. If Daytona becomes the first driver, select a different second driver with meaningfully different lifecycle or process semantics. Change the common contract only for a concrete difference OpenCode must expose.

## Package Ownership Preserves Dependency Direction

- `packages/schema`: existing provider-neutral IDs and any browser-safe public Workspace metadata.
- `packages/core`: Hosted Workspace domain, placement store, sandbox-driver interface and registry service tag, hosted Location policies, fake driver, and tests.
- `packages/server`: provider SDK adapters, provider credentials/configuration, lazy driver registration, and future lifecycle HTTP handlers.
- `packages/protocol`: sanitized public errors and Workspace endpoints only when a product API is added.
- `packages/client`: generated output only.

Core never imports a provider SDK or Server implementation. Server provides registered drivers to Core composition. Client runtime code does not depend on Core or Server.

## Verification Runs From Package Directories

Expected validation as implementation lands:

```sh
cd packages/core
bun run test -- workspace
bun typecheck

cd ../server
bun run test -- workspace
bun typecheck

cd ../schema
bun typecheck
```

If public Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client` and inspect generated client diffs. Do not edit generated clients directly.

## Deferred Work Does Not Expand The First Milestone

- public Workspace provisioning and lifecycle APIs;
- replacement bindings and retired-resource reconciliation;
- force-delete and historical Session UX;
- shared environments across simultaneous Locations;
- concurrent mutating Sessions;
- background or reconnectable commands;
- stdin and full `ChildProcessSpawner` parity;
- PTY and LSP;
- filesystem watches;
- snapshots, revert, forks, and project copies;
- full Git mutation and worktree support;
- provider migration and file transfer;
- project plugins and unrestricted application tools;
- preview ports;
- clustered leases and Session execution;
- a public sandbox-driver plugin API;
- a general capability negotiation framework;
- a resident worker inside the sandbox.

## Research Basis

The plan is based on current source review of OpenCode V2, Effect v4, Flue `v2.0.3`, pi `v0.83.0`, `@sandbox-sdk/core`, OpenAI Agents SDK sandbox sessions, and Vercel Open Agents. Provider-specific claims remain Phase 0 feasibility gates rather than settled facts.
