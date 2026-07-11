import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { define, inventory } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { dirname } from "path"

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
export namespace LinearBinding {
  export const Binding = z.object({
    teamId: z.string().describe("Linear team UUID (resolved from list_teams)"),
    teamName: z.string().describe("Linear team name (user-friendly; unique in Linear)"),
    projectId: z.string().describe("Linear project UUID (resolved from list_projects)"),
    projectName: z.string().optional().describe("Linear project name (for display)"),
    projectUrl: z
      .string()
      .optional()
      .describe("Full Linear project URL (legacy; kept for deep-linking but not used for ID resolution)"),
  })
  export type Binding = z.infer<typeof Binding>

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
  const FileSchema = z.object({
    teamId: z.string(),
    teamName: z.string(),
    projectId: z.string(),
    projectName: z.string().optional(),
    projectUrl: z.string().optional(),
    updatedAt: z.string().optional(),
  })

  export interface Interface {
    readonly get: () => Effect.Effect<Binding | null>
    readonly set: (binding: Binding | null) => Effect.Effect<Binding | null>
  }
  export class Service extends Context.Service<Service, Interface>()("@opencode/Issue/LinearBinding") {}

  const bindingFilePath = (directory: string): string => {
    // Normalize trailing slash, then append `.opencode/linear-binding.json`.
    const base = directory.endsWith("/") ? directory.slice(0, -1) : directory
    return `${base}/.opencode/linear-binding.json`
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const fs = yield* FSUtil.Service

      const writeToDisk = (directory: string, binding: Binding | null) =>
        Effect.gen(function* () {
          const file = bindingFilePath(directory)
          // Ensure <workspace>/.opencode/ exists.
          yield* fs.ensureDir(dirname(file)).pipe(Effect.orDie)
          if (!binding) {
            // Write empty file rather than deleting — avoids TOCTOU races.
            yield* fs.writeFileString(file, "{}\n").pipe(Effect.orDie)
            return
          }
          // Atomic write: temp file + rename.
          const temp = `${file}.tmp`
          const content = JSON.stringify({ ...binding, updatedAt: new Date().toISOString() }, null, 2)
          yield* fs.writeFileString(temp, content).pipe(Effect.orDie)
          yield* fs.rename(temp, file).pipe(Effect.orDie)
        })

      const loadFromDisk = (directory: string) =>
        Effect.gen(function* () {
          const file = bindingFilePath(directory)
          const exists = yield* fs.existsSafe(file)
          if (!exists) return null
          const content = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (!content || content.trim() === "{}") return null
          const parsed = FileSchema.safeParse(JSON.parse(content))
          if (!parsed.success) return null
          const b = parsed.data
          return {
            teamId: b.teamId,
            teamName: b.teamName,
            projectId: b.projectId,
            ...(b.projectName ? { projectName: b.projectName } : {}),
            ...(b.projectUrl ? { projectUrl: b.projectUrl } : {}),
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

  export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, FSUtil.node] })
}
