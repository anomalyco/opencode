export * as SessionCwdInstructions from "./cwd-instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Result, Schema } from "effect"
import { join } from "path"
import { Environment } from "../environment/index.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { Location } from "../location.js"
import { SessionCwd } from "./cwd.js"

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
   * for it. The Location's directory is skipped, because instruction discovery already loads it.
   */
  readonly load: (cwd: SessionCwd.Resolved | undefined) => Effect.Effect<Instructions.List>
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
    const discovery = yield* InstructionDiscovery.Service
    const environment = yield* Environment.Service
    const location = yield* Location.Service

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

    const read = (cwd: SessionCwd.Resolved) =>
      Effect.gen(function* () {
        const candidates = yield* Effect.forEach(
          InstructionDiscovery.filenames(discovery),
          (name) => candidate(cwd, name),
          { concurrency: "unbounded" },
        )
        // Candidates stay in priority order (AGENTS.md before CLAUDE.md): a transient error on an
        // earlier candidate preserves durable InstructionState via `unavailable` instead of falling through.
        for (const outcome of candidates) {
          if (outcome._tag === "Found") return outcome.file
          if (outcome._tag === "Unavailable") return Instructions.unavailable
        }
        return Instructions.removed
      })

    return Service.of({
      load: Effect.fn("SessionCwdInstructions.load")(function* (cwd: SessionCwd.Resolved | undefined) {
        if (!cwd || (cwd.environment.id === environment.id && cwd.absolute === location.directory))
          return source(Effect.succeed(Instructions.removed))
        return source(read(cwd))
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Environment.node, InstructionDiscovery.node, Location.node],
})
