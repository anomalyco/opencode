export * as InstructionContext from "./instruction-context"

import { Array, Effect, Layer, Schema } from "effect"
import { basename, dirname, isAbsolute, join, relative, sep } from "path"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"

const REQ_MATERIAL_NAMES = ["jd.md", "scorecard.md", "notes.md"] as const
const MAX_INSTRUCTION_CHARS = 32_000

class File extends Schema.Class<File>("InstructionContext.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = SystemContext.Key.make("core/instructions")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    const source = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const scanProject = !Flag.OPENCODE_DISABLE_PROJECT_CONFIG && insideProject
      const found = scanProject
        ? yield* fs.up({
            targets: ["AGENTS.md", join(".moks", "req")],
            start,
            stop,
          })
        : []
      const discovered = new Set(
        yield* Effect.forEach(
          found.filter((item) => basename(item) === "AGENTS.md"),
          fs.resolve,
        ),
      )

      // Nearest `.moks/req` wins; attach bounded hiring materials (not resume.md by default).
      const reqDir = found.find((item) => basename(item) === "req")
      const reqPaths: string[] = []
      if (reqDir) {
        for (const name of REQ_MATERIAL_NAMES) {
          const file = yield* fs.resolve(join(reqDir, name))
          if (yield* fs.existsSafe(file)) reqPaths.push(file)
        }
      }

      const paths = Array.dedupe([yield* fs.resolve(join(global.config, "AGENTS.md")), ...discovered, ...reqPaths])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs.readFileStringSafe(path).pipe(
            Effect.map((content) => {
              if (content === undefined) return undefined
              // Skip empty req materials; empty AGENTS.md remains available context.
              if (content === "" && isReqMaterial(path)) return undefined
              return new File({
                path: AbsolutePath.make(path),
                content: truncateInstruction(content),
              })
            }),
          ),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return SystemContext.unavailable
      return files.filter((file): file is File => file !== undefined)
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node],
})

function isReqMaterial(filepath: string) {
  if (!(REQ_MATERIAL_NAMES as readonly string[]).includes(basename(filepath))) return false
  const dir = dirname(filepath)
  return basename(dir) === "req" && basename(dirname(dir)) === ".moks"
}

function truncateInstruction(content: string) {
  if (content.length <= MAX_INSTRUCTION_CHARS) return content
  return `${content.slice(0, MAX_INSTRUCTION_CHARS)}\n\n[truncated: file exceeds ${MAX_INSTRUCTION_CHARS} characters; use the read tool for full content]`
}

function render(files: ReadonlyArray<File>) {
  return files
    .map((file) => {
      const label = isReqMaterial(file.path) ? "Req materials from" : "Instructions from"
      return `${label}: ${file.path}\n${file.content}`
    })
    .join("\n\n")
}
