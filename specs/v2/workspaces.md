# Workspaces

Status: proposal

A **Workspace** is a durable place a Session executes: a filesystem root plus processes. Hosted execution (Modal, Vercel, ...) becomes a kind of Workspace. The Session model does not change.

## Decisions

- **Workspace is the noun; sandbox is a kind.** `Location.workspaceID` names a Workspace; omitted still means implicit local, unchanged.
- **A Workspace is an empty environment.** No repository, project, or name at creation. Cloning happens later, inside a Session. _A Workspace may contain a Project; a Workspace is not a Project._
- **Creation is eager.** `create` resolves when the environment is usable. No pending states, no lazy attachment, no detached Sessions.
- **Providers are pluggable drivers** behind a three-verb seam, selected by provider string.

## Public API

```typescript
const workspace = await workspaces.create({ provider: "modal" })

const session = await sessions.create({
  location: { workspaceID: workspace.id, directory: workspace.root },
})
```

Consumers persist the Workspace ID as their durable handle and re-derive everything else:

```typescript
const workspace = await workspaces.get(id) // { id, provider, root } — table read, never contacts a provider
```

- `provider` is required for now. A config default (`workspace.provider`) can be added later without breaking anything; skipping it keeps config untouched.
- `root` is an absolute POSIX path in the provider filesystem.
- `get` fails with typed `WorkspaceNotFound` — also the existence check. No `getOrCreate`: the consumer owns its "which Workspace is mine" mapping, and provider-level get-or-create can silently replace resources (Vercel tracer finding).

## Domain Model

| Concept              | What it is                                                     | Visibility                       |
| -------------------- | -------------------------------------------------------------- | -------------------------------- |
| Workspace            | Durable execution environment: `id` + `root`                   | Public                           |
| Sandbox              | The hosted kind of Workspace                                   | Vocabulary only, not an API noun |
| Binding              | Smallest provider-owned JSON to reconnect to the same resource | Internal, stored opaquely        |
| WorkspaceEnvironment | Scoped live connection: files + processes at the root          | Internal seam                    |
| Project              | Repository identity discovered _within_ a Location             | Public, becomes optional         |

Binding is all that earlier drafts called "placement" — a column, not a concept. Provider resource replacement (Modal snapshot → new sandbox) is the same Workspace with an updated binding.

## Driver Seam

```typescript title="packages/core/src/workspace/driver.ts"
export * as WorkspaceDriver from "./driver"

export const Binding = Schema.Record(Schema.String, Schema.Json)
export type Binding = typeof Binding.Type

export interface Interface {
  // allocate; resolve only when ready to use
  readonly create: (input: {
    readonly workspaceID: Workspace.ID
  }) => Effect.Effect<{ binding: Binding; root: string }, Error>

  // binding -> live capabilities; the ONLY way to obtain an environment
  readonly connect: (binding: Binding) => Effect.Effect<WorkspaceEnvironment.Interface, Error, Scope.Scope>

  // permanently release provider resources
  readonly destroy: (binding: Binding) => Effect.Effect<void, Error>
}

// one error shape for all three verbs; ProviderNotFoundError stays separate
export class Error extends Schema.TaggedErrorClass<Error>()("WorkspaceDriver.Error", {
  provider: Schema.String,
  message: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "WorkspaceDriver.ProviderNotFoundError",
  { provider: Schema.String },
) {}

export interface Registry {
  readonly get: (provider: string) => Effect.Effect<Interface, ProviderNotFoundError>
}

export class RegistryService extends Context.Service<RegistryService, Registry>()(
  "@opencode/WorkspaceDriverRegistry",
) {}
```

- Fresh-create and restart-reconnect both flow through `connect` — where the prior tracers found their bugs.
- `connect` is scoped: environment lifetime = the acquiring scope (the existing cached Location graph). Scope closure drops the connection, never the provider resource. No `close` verb.
- Errors are `Schema.TaggedErrorClass` values.

## Defining A Driver

A driver is a plain value built in `packages/server`. Its binding schema is driver-private — opaque JSON becomes typed again at this boundary:

```typescript title="packages/server/src/workspace/modal.ts"
export * as ModalDriver from "./modal"

const ModalBinding = Schema.Struct({ sandboxId: Schema.String })

const ROOT = "/workspace"

export const make = Effect.gen(function* () {
  const app = yield* Effect.promise(() => App.lookup("opencode-workspaces", { createIfMissing: true }))
  // git, bash, rg provisioned in the image — never discovered opportunistically
  const image = Image.fromRegistry("ghcr.io/anomalyco/opencode-workspace:1")

  const decode = (binding: WorkspaceDriver.Binding) =>
    Schema.decodeUnknownEffect(ModalBinding)(binding).pipe(
      Effect.mapError((cause) => new WorkspaceDriver.Error({ provider: "modal", cause })),
    )

  return WorkspaceDriver.make({
    create: ({ workspaceID }) =>
      Effect.promise(() => Sandbox.create(app, { image, name: workspaceID })).pipe(
        Effect.map((sandbox) => ({ binding: { sandboxId: sandbox.sandboxId }, root: ROOT })),
      ),

    connect: Effect.fnUntraced(function* (binding) {
      const decoded = yield* decode(binding)
      const sandbox = yield* Effect.promise(() => Sandbox.fromId(decoded.sandboxId))
      return WorkspaceEnvironment.make({
        platform: "linux",
        directory: ROOT,
        files: modalFiles(sandbox), // Files over the sandbox filesystem API
        process: modalSpawner(sandbox), // ChildProcessSpawner over sandbox.exec
        shell: WorkspaceEnvironment.linuxShell,
      })
    }),

    destroy: (binding) =>
      decode(binding).pipe(
        Effect.flatMap((decoded) =>
          Effect.promise(async () => {
            const sandbox = await Sandbox.fromId(decoded.sandboxId)
            await sandbox.terminate()
          }),
        ),
      ),
  })
})
```

## Registering Drivers

Ordinary Server composition. The registry is an immutable map fixed at boot:

```typescript title="packages/server/src/workspace/drivers.ts"
export * as ServerWorkspaceDrivers from "./drivers"

export const layer = Layer.effect(
  WorkspaceDriver.RegistryService,
  Effect.gen(function* () {
    const drivers = {
      modal: yield* ModalDriver.make,
      vercel: yield* VercelDriver.make,
    }
    return WorkspaceDriver.RegistryService.of({
      get: (provider) =>
        drivers[provider]
          ? Effect.succeed(drivers[provider])
          : Effect.fail(new WorkspaceDriver.ProviderNotFoundError({ provider })),
    })
  }),
)

export const node = makeGlobalNode({ service: WorkspaceDriver.RegistryService, layer, deps: [] })
```

Core consumes it blindly:

```typescript
// workspaces.create
const driver = yield * registry.get(input.provider)
const created = yield * driver.create({ workspaceID: id })
yield * store.insert({ id, provider: input.provider, binding: created.binding, root: created.root })

// hosted Location graph construction (inside the existing scoped cache)
const workspace = yield * store.get(location.workspaceID)
const driver = yield * registry.get(workspace.provider)
const env = yield * driver.connect(workspace.binding)
```

- Core defines the key and consumes; Server defines drivers and provides the layer; core never sees a provider SDK.
- Drivers ship in-tree for now. Plugin-contributed drivers later change only how the map is built; `Registry.get` and consumers are untouched.

## Environment

Reuses the seam proven on `origin/remote-workspaces-plan` (`fd92aeac66`) — a local implementation exists and the Location graph composes over it:

```typescript title="packages/core/src/workspace/environment.ts"
export * as WorkspaceEnvironment from "./environment"

export interface Interface {
  readonly directory: string // the Workspace root, absolute in the provider filesystem
  readonly files: Files // stat / realPath / read / list / write / remove — one provider round trip each
  readonly process: ChildProcessSpawner["Service"]
  readonly shell: Shell // executable + args lowering for the bash tool; linuxShell default
}
```

- `files` is separate from `process`: providers expose direct filesystem APIs far faster than shelling out `cat`, and read/write/edit are the hottest ops.
- `Files` grows only when a domain service needs the verb. Type mismatches (read a directory, list a file) fail from the op itself — no stat pre-checks on the happy path.
- Core builds tools (bash, read, edit, glob, grep) on top. Drivers never know what a tool is.
- The branch's `ripgrep` field is dropped — tool implementation detail leaking into the seam. The image contract mandates `rg`; the hosted graph provides the existing `RipgrepBinary.Service` as `Effect.succeed("rg")`.

## Target Architecture

**Hosting is decided when the Location graph compiles, never when a tool executes.** A tool cannot name `WorkspaceEnvironment`, `FSUtil`, or any host path API; if a tool can observe where it runs, the layering is broken. Everything model-facing sits on four Location-scoped domain services, and only their implementations know about machines:

```
                    TOOLS (hosting-blind policy + orchestration)
        edit      write      patch      shell-tool      read-tool
          │         │          │           │               │
          ▼         ▼          ▼           ▼               ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                DOMAIN SERVICES — one implementation each      │
   │                                                               │
   │  LocationMutation.resolve   path → Target (lexical path,     │
   │                             canonical referent,              │
   │                             permission resources,            │
   │                             external-directory approvals)    │
   │  FileMutation               read / write / remove — locks,   │
   │                             BOM, formatting, typed errors    │
   │  FileSystem                 read-model queries               │
   │  Shell                      spawn + lifecycle (owns cwd      │
   │                             validation per backend)          │
   └───────────────────────────┬───────────────────────────────────┘
                               │ consumes only
                               ▼
   ┌───────────────────────────────────────────────────────────────┐
   │        WorkspaceEnvironment — THE seam (one per graph)        │
   │        directory ∙ files ∙ process ∙ shell                    │
   └──────────────┬──────────────────────────────┬─────────────────┘
                  │ local graph                  │ hosted graph
                  ▼                              ▼
        host adapter                    driver.connect(binding)
        (the only home of               (Modal, fake, …)
         FSUtil / host spawn)
```

The four domain services own all cross-cutting policy exactly once:

- **`LocationMutation.resolve(path, kind?)`** — path → `Target { absolute, canonical, resource, externalDirectory? }`. `absolute` is the normalized lexical path the model named; permissions and entry operations use it. `canonical` is the resolved referent used for reads, writes, and locking. Thus reads/writes follow a symlink while remove unlinks the symlink itself, and permission resources always describe the named path. Path semantics (posix in providers, win32 locally), containment, and permission-resource derivation live here; tools pass targets around without re-deriving anything.
- **`FileMutation`** — the read–transform–write seam:

  ```typescript
  read(target)                        → string    // BOM stripped inside the seam
  writeTextPreservingBom({ target, content })
                                      → { existed, content }  // lock ∙ BOM rejoin ∙ format ∙ final text
  write({ target, content })          → { existed }           // raw bytes, no formatting
  remove(target)                      → void
  // errors: FileMutation.NotFoundError | FileMutation.NotAFileError | filesystem error
  ```

  BOM handling, per-target locking, formatter execution, and error classification are implementation details here. Tools never import `Bom`, never call `Formatter`, never see a backend error vocabulary.

- **`FileSystem`** — read-model queries for the read tool and file browsing.
- **`Shell`** — command execution; each backend validates its own cwd and surfaces one error shape.

Every model-facing tool then reads as pure policy over these:

```typescript
// EditTool.execute — identical local and hosted
const target = yield * mutation.resolve({ path: input.path, kind: "file" })
const original = yield * files.read(target) // NotFoundError → "File not found"
const replaced = replace(original, input.oldString, input.newString) // pure
yield * permission.assert({ action: "edit", resources: [target.resource], diff })
const result = yield * files.writeTextPreservingBom({ target, content: replaced })
return { files: [fileDiff(target.resource, original, result.content)] }

// PatchTool.execute — identical local and hosted
const hunks = Patch.parse(input.patchText) // pure
for (const hunk of hunks) {
  const target = yield * mutation.resolve({ path: hunk.path })
  const original = yield * files.read(target) // updates and deletes
  prepared.push(derive(hunk, target, original)) // pure
}
yield * permission.assert({ action: "edit", resources, diffs })
for (const change of prepared) {
  // add/update → files.writeTextPreservingBom, delete/move → files.remove
}
```

Local vs hosted is then a compilation difference, not a code difference:

| Layer                | Local graph                      | Hosted graph                                                     |
| -------------------- | -------------------------------- | ---------------------------------------------------------------- |
| Tools                | identical bytes                  | identical bytes                                                  |
| Domain services      | identical bytes                  | identical bytes                                                  |
| WorkspaceEnvironment | host adapter (fs + spawn)        | `driver.connect(binding)`                                        |
| Formatting           | runs (host binaries, host files) | inert until an environment formatter runtime exists              |
| Catalog              | full                             | minus tools without environment-backed execution yet (glob/grep) |

### Staging

1. **Now:** tools move onto the domain services; each service carries a local and a hosted node. Plugins become provably hosting-blind — the plugin context stops carrying any environment or host filesystem capability.
2. **Follow-up ("local is an environment"):** bind `WorkspaceEnvironment` in every graph — local binds a host adapter — and collapse each domain service's hosted/local node pair into one implementation over `env.files`/`env.process`. `FSUtil` remains only below the seam and in genuinely host-domain services (global config, credentials, npm). The hosted branch of graph construction shrinks to swapping `Location`, `Config`/`InstructionDiscovery`, and `WorkspaceEnvironment`.

### Prior Art Convergence

Surveyed grok-build (xAI), pi-mono, and flue (2026-08): all three converged on this exact seam — one byte-level filesystem-plus-exec capability that tools never bypass (grok's `AsyncFileSystem` resource with an ACP-remote adapter, pi-mono's `ExecutionEnv` with typed backend-independent `FileError` codes, flue's `Sandbox` where local is just another adapter). Flue ships stage 2 outright: zero mode branching in tools, local as an adapter file. None found a smaller shape; the simpler-looking tool layers achieve it by descoping policy we deliberately keep (flue and grok-build skip BOM handling and share the resulting byte-0 match bug; flue propagates raw `ENOENT` to the model; none run formatters or in-tool permission prompts). pi-mono's per-path mutation queue and flue's `withFileMutationLock` are this design's `FileMutation` locking, independently reinvented.

## Persistence

One V2-owned table; no interaction with the V1 `workspace` table. Metadata reads never contact a provider.

```typescript
const table = sqliteTable("workspace", {
  id: text().primaryKey(), // Workspace.ID
  provider: text().notNull(), // driver registry key
  binding: text({ mode: "json" }).notNull(), // opaque driver-owned JSON
  root: text().notNull(), // absolute POSIX root in provider filesystem
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
```

## Core Changes

1. **Session admission** — `workspaceID` present skips host `Project.resolve`; directory validated with `path.posix` containment in the root. `session.project_id` becomes optional: an empty Workspace has no honest Project.
2. **Location graph** — `LocationServiceMap` selects local or hosted construction; hosted acquires via `driver.connect(binding)` inside the existing scoped cache.
3. **Tool catalog** — hosted Locations advertise only environment-backed tools. Nothing may fall back to host authority.

| In an empty Workspace |                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Available             | read/write/edit, bash, glob/grep, global config/agents/instructions, models, integrations               |
| Needs a Project       | git status/diffs, snapshots/revert, project instructions/config/skills/plugins, repo-scoped permissions |

### Project Identity For Hosted Sessions

- Admission consults **stored facts only** — never live discovery, never a driver. A stopped sandbox must not block `sessions.create`.
- An empty Workspace has no repository, so hosted Sessions reuse `Project.ID.global` — the same degenerate Project local non-VCS directories already get. This is "not discovered yet," not a new concept.
- Project identity is machine-independent by design (`Hash.fast("git-remote:" + origin)`, root-commit fallback). Once the rediscover slice runs discovery _inside_ the Workspace, a hosted clone of a repo joins the same Project as local checkouts automatically.
- The rediscover slice adds nullable `workspace.project_id`, stamped when discovery finds a repo; admission then reads `workspace.project_id ?? global`. Not added now — nothing writes it in this slice.

## First Milestone

1. **Fake driver, real runner.** `create()` → Session at root → write file → run command → evict + rebuild Location graph → reconnect → file still there. Local paths byte-identical throughout.
2. **First real driver.** Vercel provisional, Modal fallback — decided by the feasibility gates in `remote-workspace-execution.md`. Credential-gated live tests; second-process restart test reconstructing the binding from SQLite.

Next slice (not this one): clone-a-repo-during-a-Session, which needs an explicit "rediscover Location context" operation (Project detection, config rebuild, instruction-epoch refresh).

Deferred: lazy attachment / detached Sessions, stop/resume + TTL policy, multi-Session Workspaces, PTY / LSP / watchers / snapshots, plugin driver API, preview ports.

## Open Questions

- Does `ChildProcessSpawner`'s full surface (stdin, extra fds, `unref`, PIDs) map honestly to provider process APIs? The superseded plan proposed a narrower foreground contract; resolve against the first real driver.
- `session.project_id` nullability migration and Project-requiring read models.
- Where `workspaces.create` surfaces first: SDK/HTTP only; TUI/web later.

## Prior Art

`origin/remote-workspaces-plan`: `09903e120f` (plan + live Vercel tracer), `fd92aeac66` (environment seam + local impl), `d1b9b6c9ce` (live Modal tracer: reconnect, snapshot, restore), `650d5a5e92` (lifecycle). Both tracers already worked repository-free; only that branch's outer Workspace API carried Project assumptions — dropped here.

`specs/v2/remote-workspace-execution.md` is superseded for domain model and API, retained for execution research: feasibility gates, process laws, host-authority tripwires, phase acceptance criteria.
