export * as InstructionDiscovery from "./instruction-discovery"

import { Array, Context, Effect, Layer, Schema } from "effect"
import { isAbsolute, join, relative, sep } from "path"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { Instructions } from "./instructions/index"
import { makeLocationNode } from "./effect/app-node"

class File extends Schema.Class<File>("InstructionDiscovery.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = Instructions.Key.make("core/instructions")

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InstructionDiscovery") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service

    const source = (value: ReadonlyArray<File> | Instructions.Unavailable | Instructions.Removed) =>
      Instructions.make<ReadonlyArray<File>>({
        key,
        codec: Schema.toCodecJson(Files),
        read: Effect.succeed(value),
        render: {
          initial: render,
          changed: (_previous, current) =>
            `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
          removed: () => "Previously loaded instructions no longer apply.",
        },
      })

    const observe = Effect.fn("InstructionDiscovery.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const discovered = new Set(
        yield* Effect.forEach(
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject
            ? []
            : yield* fs.up({
                targets: ["AGENTS.md"],
                start,
                stop,
              }),
          fs.resolve,
        ),
      )
      const paths = Array.dedupe([yield* fs.resolve(join(global.config, "AGENTS.md")), ...discovered])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return Instructions.unavailable
      return files.filter((file): file is File => file !== undefined)
    })

    return Service.of({
      load: () =>
        observe().pipe(
          Effect.map((files) =>
            Array.isArray(files) && files.length === 0 ? source(Instructions.removed) : source(files),
          ),
          Effect.catch(() => Effect.succeed(source(Instructions.unavailable))),
          Effect.catchDefect(() => Effect.succeed(source(Instructions.unavailable))),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Global.node, Location.node] })

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
