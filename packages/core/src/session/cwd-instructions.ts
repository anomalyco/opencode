export * as SessionCwdInstructions from "./cwd-instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { join } from "path"
import { Database } from "../database/database.js"
import { Environments } from "../environment/environments.js"
import { Environment } from "../environment/index.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { Location } from "../location.js"
import { SessionCwd } from "./cwd.js"
import type { SessionSchema } from "./schema.js"
import { InstructionStateTable } from "./sql.js"

// Guidance belongs in context; a file this large is not guidance, so it is skipped instead of crowding out history.
const MAX_BYTES = 512 * 1024

const key = Instructions.Key.make("core/cwd-instructions")

type Outcome =
  | { readonly _tag: "Found"; readonly file: InstructionDiscovery.File }
  /** No such file, or not a file this reads. */
  | { readonly _tag: "Absent" }
  /** A read that failed for now, such as a machine that is offline. */
  | { readonly _tag: "Unavailable" }

export interface Interface {
  /**
   * Loads the working directory's own instruction file: AGENTS.md, or the CLAUDE.md that stands in
   * for it. Skips when project discovery is off or when InstructionDiscovery already covers the directory.
   */
  readonly load: (
    cwd: SessionCwd.Resolved | undefined,
    sessionID?: SessionSchema.ID,
  ) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCwdInstructions") {}

const source = (read: Effect.Effect<InstructionDiscovery.File | Instructions.Unavailable | Instructions.Removed>) =>
  Instructions.make<InstructionDiscovery.File>({
    key,
    codec: Schema.toCodecJson(InstructionDiscovery.File),
    read,
    render: {
      initial: (file) => `Instructions from: ${file.path}\n${file.content}`,
      changed: (_previous, file) => `Instructions from: ${file.path}\n${file.content}`,
      removed: () => "The previous working directory instructions no longer apply.",
    },
  })

const absent: Outcome = { _tag: "Absent" }
const unavailable: Outcome = { _tag: "Unavailable" }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = Option.getOrUndefined(yield* Effect.serviceOption(Database.Service))
    const discovery = yield* InstructionDiscovery.Service
    const environment = yield* Environment.Service
    const environments = yield* Environments.Service
    const location = yield* Location.Service

    const hasStoredInstructions = (sessionID: SessionSchema.ID | undefined) => {
      if (!database || !sessionID) return Effect.succeed(false)
      return database.db
        .select({ values: InstructionStateTable.current_values })
        .from(InstructionStateTable)
        .where(eq(InstructionStateTable.session_id, sessionID))
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined && Object.hasOwn(row.values, key)),
        )
    }

    const coveredByDiscovery = (cwd: SessionCwd.Resolved) => {
      if (cwd.environment.id !== environment.id) return false
      if (cwd.absolute === location.directory) return true
      // InstructionDiscovery walks up from location.directory to location.project.directory,
      // so any local ancestor along that chain is already loaded.
      return (
        FSUtil.contains(location.project.directory, cwd.absolute) && FSUtil.contains(cwd.absolute, location.directory)
      )
    }

    const candidate = (cwd: SessionCwd.Resolved, name: string): Effect.Effect<Outcome> =>
      Effect.gen(function* () {
        const target = (cwd.environment.path?.join ?? join)(cwd.absolute, name)
        // One bounded read follows symlinks and rejects oversized targets before decoding.
        const file = yield* Effect.result(cwd.environment.files.read(target, { offset: 0, length: MAX_BYTES + 1 }))
        if (Result.isFailure(file)) return file.failure._tag === "Environment.Failed" ? unavailable : absent
        if (file.success.info.size > MAX_BYTES || file.success.bytes.byteLength > MAX_BYTES) return absent
        return {
          _tag: "Found",
          file: new InstructionDiscovery.File({
            path: SessionCwd.format(cwd, target, environment.id),
            content: new TextDecoder().decode(file.success.bytes),
          }),
        }
      })

    const read = (cwd: SessionCwd.Resolved, sessionID: SessionSchema.ID | undefined) =>
      Effect.gen(function* () {
        const candidates = yield* Effect.forEach(
          InstructionDiscovery.filenames(discovery),
          (name) => candidate(cwd, name),
          { concurrency: "unbounded" },
        )
        // Candidates stay in priority order (AGENTS.md before CLAUDE.md). On a transient error,
        // preserve previously loaded instructions via `unavailable`, but return `removed` when
        // nothing was loaded yet so an offline or removed machine never blocks the first step.
        for (const outcome of candidates) {
          if (outcome._tag === "Found") return outcome.file
          if (outcome._tag === "Unavailable")
            return (yield* hasStoredInstructions(sessionID)) ? Instructions.unavailable : Instructions.removed
        }
        return Instructions.removed
      })

    return Service.of({
      load: Effect.fn("SessionCwdInstructions.load")(function* (
        cwd: SessionCwd.Resolved | undefined,
        sessionID?: SessionSchema.ID,
      ) {
        if (!cwd || !discovery.project || coveredByDiscovery(cwd)) return source(Effect.succeed(Instructions.removed))
        // Do not wake a cold or lazy sandbox just to probe for AGENTS.md before the model calls a tool.
        if (!(yield* environments.ready(cwd.environment.id)))
          return source(
            hasStoredInstructions(sessionID).pipe(
              Effect.map((stored) => (stored ? Instructions.unavailable : Instructions.removed)),
            ),
          )
        return source(read(cwd, sessionID))
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, Environment.node, Environments.node, InstructionDiscovery.node, Location.node],
})
