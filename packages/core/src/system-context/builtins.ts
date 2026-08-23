export * as SystemContextBuiltIns from "./builtins"

import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

// Mirrors the slug used by the memory tool so both read the same directory.
function memoryDir(globalData: string, worktree: string) {
  let hash = 0
  for (let i = 0; i < worktree.length; i++) {
    hash = (Math.imul(31, hash) + worktree.charCodeAt(i)) | 0
  }
  const base = path.basename(worktree).replace(/[^a-zA-Z0-9_-]/g, "") || "project"
  return path.join(globalData, "memory", `${base}-${(hash >>> 0).toString(36)}`)
}

const loadMemoryIndex = Effect.fn("SystemContextBuiltIns.loadMemoryIndex")(function* (
  fs: FSUtil.Interface,
  dir: string,
) {
  const exists = yield* fs.existsSafe(dir)
  if (!exists) return ""
  const files = (yield* fs.glob("**/*.md", { cwd: dir }).pipe(Effect.catch(() => Effect.succeed([])))).sort()
  if (files.length === 0) return ""
  const lines: string[] = []
  for (const file of files.slice(0, 50)) {
    const content =
      (yield* fs.readFileStringSafe(path.join(dir, file)).pipe(Effect.catch(() => Effect.succeed(undefined))))
        ?.split("\n")
        .find((l) => l.trim()) ?? ""
    lines.push(`- ${file.replace(/\.md$/, "")}${content ? ` — ${content.slice(0, 120)}` : ""}`)
  }
  return [
    "Persistent project memories recorded by previous sessions (use the memory tool to read or update):",
    ...lines,
  ].join("\n")
})

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service
    const registry = yield* SystemContextRegistry.Service
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/memory"),
        codec: Schema.toCodecJson(Schema.String),
        load: loadMemoryIndex(fs, memoryDir(global.data, location.project.directory)),
        baseline: (index) => (index ? index : ""),
        update: (_previous, index) => (index ? index : ""),
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})
