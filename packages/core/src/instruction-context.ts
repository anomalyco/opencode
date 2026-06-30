export * as InstructionContext from "./instruction-context"

import { Array, Context, Effect, Layer, Schema } from "effect"
import { dirname, isAbsolute, join, relative, sep } from "path"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"

export class InstructionFile extends Schema.Class<InstructionFile>("InstructionContext.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(InstructionFile)
const key = SystemContext.Key.make("core/instructions")
const targets = ["AGENTS.md"]

export interface Interface {
  readonly load: () => Effect.Effect<SystemContext.SystemContext>
  readonly resolveForPath: (input: {
    readonly path: AbsolutePath
    readonly kind: "file" | "directory"
    readonly sessionID: string
  }) => Effect.Effect<readonly InstructionFile[], FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionContext") {}

const serviceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    // ponytail: process-local dedupe; move to durable session context when scoped instructions leave the read tool.
    const claims = new Map<string, Set<string>>()

    const source = (value: ReadonlyArray<InstructionFile> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    const ambientPaths = Effect.fn("InstructionContext.ambientPaths")(function* () {
      const start = FSUtil.resolve(location.directory)
      const stop = FSUtil.resolve(location.project.directory)
      const discovered = new Set(
        (Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject(start, stop)
          ? []
          : yield* fs.up({
              targets,
              start,
              stop,
            })
        ).map(FSUtil.resolve),
      )
      return Array.dedupe([FSUtil.resolve(join(global.config, "AGENTS.md")), ...discovered])
    })

    const readFiles = Effect.fn("InstructionContext.readFiles")(function* (paths: readonly string[]) {
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new InstructionFile({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      return files
    })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const paths = yield* ambientPaths()
      const discovered = new Set(paths.filter((path) => path !== FSUtil.resolve(join(global.config, "AGENTS.md"))))
      const files = yield* readFiles(paths)
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return SystemContext.unavailable
      return files.filter((file): file is InstructionFile => file !== undefined)
    })

    const load = Effect.fn("InstructionContext.load")(function* () {
      return yield* observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      )
    })

    const resolveForPath = Effect.fn("InstructionContext.resolveForPath")(function* (input: {
      readonly path: AbsolutePath
      readonly kind: "file" | "directory"
      readonly sessionID: string
    }) {
      if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return []
      const target = FSUtil.resolve(input.path)
      const start = input.kind === "directory" ? target : dirname(target)
      const stop = FSUtil.resolve(location.project.directory)
      if (!insideProject(start, stop)) return []

      const ambient = new Set(yield* ambientPaths())
      const paths = Array.dedupe((yield* fs.up({ targets, start, stop })).map(FSUtil.resolve)).filter(
        (path) => path !== target && !ambient.has(path),
      )
      const delivered = claims.get(input.sessionID) ?? new Set<string>()
      claims.set(input.sessionID, delivered)
      const fresh = paths.filter((path) => !delivered.has(path))
      const files = (yield* readFiles(fresh)).filter((file): file is InstructionFile => file !== undefined)
      for (const file of files) delivered.add(file.path)
      return files
    })

    return Service.of({ load, resolveForPath })
  }),
)

const registrationLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    const service = yield* Service

    yield* registry.register({
      key,
      load: service.load(),
    })
  }),
)

export const layer = registrationLayer.pipe(Layer.provideMerge(serviceLayer))

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node],
})

function render(files: ReadonlyArray<InstructionFile>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}

function insideProject(start: string, stop: string) {
  const fromProject = relative(stop, start)
  return fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
}
