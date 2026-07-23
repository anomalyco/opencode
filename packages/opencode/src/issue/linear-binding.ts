import { Effect, Layer, Context, Schema, Option, Path, DateTime } from "effect"
import { define, inventory } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { path } from "@opencode-ai/core/effect/app-node-platform"
import { InstanceState } from "@/effect/instance-state"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

/**
 * LinearBinding — workspace-scoped storage for Linear team/project binding.
 *
 * Per ADR-0004: teamId/teamName/projectId are workspace-scoped, not global.
 * They live in `<workspace>/.opencode/linear-binding.json` and are cached in
 * InstanceState (per-directory). The global `Config.Linear` keeps only
 * user-level preferences (syncMode, autoPush).
 *
 * Storage strategy (dual-write):
 *   - Cache: InstanceState<Binding | null> — keyed by Instance.directory,
 *     populated on first read from the JSON file. Reads never touch the
 *     filesystem after the first hit.
 *   - Persistence: <workspace>/.opencode/linear-binding.json — written
 *     atomically (temp file + rename) on every set(). Lives inside the
 *     workspace directory so macOS TCC does not apply.
 */
export const Binding = Schema.Struct({
  teamId: Schema.String.annotate({ description: "Linear team UUID (resolved from list_teams)" }),
  teamName: Schema.String.annotate({ description: "Linear team name (user-friendly; unique in Linear)" }),
  projectId: Schema.String.annotate({ description: "Linear project UUID (resolved from list_projects)" }),
  projectName: Schema.optional(Schema.String).annotate({ description: "Linear project name (for display)" }),
  projectUrl: Schema.optional(Schema.String).annotate({
    description: "Full Linear project URL (legacy; kept for deep-linking but not used for ID resolution)",
  }),
}).annotate({ identifier: "LinearBinding" })
export type Binding = Schema.Schema.Type<typeof Binding>

/**
 * Event published when the binding is updated. The desktop UI's event
 * reducer reacts by calling `globalSync.todo.refresh(directory)` so the
 * todo list reflects the new binding immediately. The write + event
 * publish happen in one Effect transaction — atomic.
 */
const Updated = define({
  type: "linear.binding.updated",
  schema: {
    directory: Schema.String,
    binding: Schema.NullOr(Schema.Unknown),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }

/**
 * File layout for `<workspace>/.opencode/linear-binding.json`.
 * `updatedAt` is for human inspection; the service does not parse it back.
 */
const FileSchema = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  projectId: Schema.String,
  projectName: Schema.optional(Schema.String),
  projectUrl: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
})
const decodeFile = Schema.decodeUnknownOption(FileSchema)

export interface Interface {
  readonly get: () => Effect.Effect<Binding | null>
  readonly set: (binding: Binding | null) => Effect.Effect<Binding | null>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/Issue/LinearBinding") {}

const bindingFilePath = (path: Path.Path, directory: string): string =>
  // `Path.join` normalizes trailing slashes and cross-platform separators.
  path.join(directory, ".opencode", "linear-binding.json")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const fs = yield* FSUtil.Service
    const pathSvc = yield* Path.Path

    const writeToDisk = (directory: string, binding: Binding | null) =>
      Effect.gen(function* () {
        const file = bindingFilePath(pathSvc, directory)
        // Ensure <workspace>/.opencode/ exists.
        yield* fs.ensureDir(pathSvc.dirname(file)).pipe(Effect.orDie)
        if (!binding) {
          // Write empty file rather than deleting — avoids TOCTOU races.
          yield* fs.writeFileString(file, "{}\n").pipe(Effect.orDie)
          return
        }
        // Atomic write: temp file + rename. Suffix concatenation is safe
        // here — `file` is already a normalized absolute path.
        const temp = `${file}.tmp`
        const now = yield* DateTime.nowAsDate
        const content = JSON.stringify({ ...binding, updatedAt: now.toISOString() }, null, 2)
        yield* fs.writeFileString(temp, content).pipe(Effect.orDie)
        yield* fs.rename(temp, file).pipe(Effect.orDie)
      })

    const loadFromDisk = (directory: string) =>
      Effect.gen(function* () {
        const file = bindingFilePath(pathSvc, directory)
        const exists = yield* fs.existsSafe(file)
        if (!exists) return null
        const content = yield* fs.readFileString(file).pipe(
          // File vanished between existsSafe and readFileString (race) or
          // read error — treat as missing. `Effect.catch` only catches
          // recoverable errors; defects (Interrupt/Die) propagate naturally.
          //
          // NOTE: This is a deliberate catch-all (not `catchTag`) because
          // we genuinely want to swallow ANY FS error — race, permission,
          // I/O — and treat the binding as missing. `catchTag` requires a
          // specific tagged error type, but FSUtil errors are untagged.
          // This is an exception to the catchTag rule for a best-effort
          // file read where precise error handling is not the intent.
          Effect.catch(() => Effect.succeed(null)),
        )
        if (!content || content.trim() === "{}") return null
        const json = Option.getOrUndefined(decodeJson(content))
        if (!json) return null
        // `decodeFile` returns Option<Binding-shaped row>; `None` covers both
        // decode failures and missing required fields.
        const parsed = Option.getOrUndefined(decodeFile(json))
        if (!parsed) return null
        return {
          teamId: parsed.teamId,
          teamName: parsed.teamName,
          projectId: parsed.projectId,
          ...(parsed.projectName !== undefined ? { projectName: parsed.projectName } : {}),
          ...(parsed.projectUrl !== undefined ? { projectUrl: parsed.projectUrl } : {}),
        }
      })

    // InstanceState lookup: on cache miss, load from disk.
    const state = yield* InstanceState.make<Binding | null>(
      Effect.fn("LinearBinding.state")(function* (ctx) {
        return yield* loadFromDisk(ctx.directory)
      }),
    )

    const get = Effect.fn("LinearBinding.get")(function* () {
      return yield* InstanceState.get(state)
    })

    const set = Effect.fn("LinearBinding.set")(function* (binding: Binding | null) {
      const directory = yield* InstanceState.directory
      // 1. Write to disk (atomic temp+rename).
      yield* writeToDisk(directory, binding)
      // 2. Invalidate the InstanceState cache so the next read reloads
      //    from disk. ScopedCache has no set() — invalidate + next get()
      //    re-runs the lookup function which reads the freshly-written
      //    file. This guarantees cache/disk consistency.
      yield* InstanceState.invalidate(state)
      // 3. Publish event — UI refresh hook reacts to this.
      yield* events.publish(Event.Updated, { directory, binding })
      return binding
    })

    return Service.of({ get, set })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, FSUtil.node, path] })

export * as LinearBinding from "./linear-binding"
