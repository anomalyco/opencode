import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./memory.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "read", "write", "delete"]).annotate({
    description:
      "list: show stored memories. read: read one memory file. write: create or update a memory file. delete: remove a memory file.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description:
      "Memory name without extension, e.g. 'user-preferences' or 'architecture/decisions'. Required for read, write and delete.",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Markdown content to store. Required for write.",
  }),
})

function memoryDir(globalData: string, worktree: string) {
  // Slug the worktree so different projects never share memories.
  let hash = 0
  for (let i = 0; i < worktree.length; i++) {
    hash = (Math.imul(31, hash) + worktree.charCodeAt(i)) | 0
  }
  const base = path.basename(worktree).replace(/[^a-zA-Z0-9_-]/g, "") || "project"
  return path.join(globalData, "memory", `${base}-${(hash >>> 0).toString(36)}`)
}

const normalizeName = (name: string) => {
  if (!name.trim()) throw new Error("memory name is required")
  const cleaned = name.replace(/^\/+|\/+$/g, "").replace(/\.md$/, "")
  if (!cleaned || cleaned.includes("..")) throw new Error(`invalid memory name: ${name}`)
  return `${cleaned}.md`
}

type Metadata = {
  count?: number
}

export const MemoryTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service | Global.Service>(
  "memory",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const dir = memoryDir(global.data, ins.worktree)

          yield* ctx.ask({
            permission: "memory",
            patterns: ["*"],
            always: ["*"],
            metadata: { action: params.action, name: params.name },
          })

          if (params.action === "list") {
            yield* fs.ensureDir(dir)
            const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.catch(() => Effect.succeed([])))
            const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"))
            if (files.length === 0) return { title: "memory", metadata: {}, output: "No memories stored yet." }
            const lines = []
            for (const file of files) {
              const content =
                (yield* fs.readFileStringSafe(path.join(dir, file.name)))?.split("\n").find((l) => l.trim()) ?? ""
              lines.push(`- ${file.name.replace(/\.md$/, "")}${content ? ` — ${content.slice(0, 120)}` : ""}`)
            }
            return { title: `${files.length} memories`, metadata: { count: files.length }, output: lines.join("\n") }
          }

          if (!params.name) throw new Error(`'name' is required for action '${params.action}'`)
          const file = normalizeName(params.name)
          const target = path.join(dir, file)

          if (params.action === "read") {
            const content = yield* fs.readFileStringSafe(target)
            if (content === undefined) throw new Error(`memory not found: ${params.name}`)
            return { title: params.name, metadata: {}, output: content }
          }

          if (params.action === "write") {
            if (params.content === undefined) throw new Error("'content' is required for action 'write'")
            yield* fs.writeWithDirs(target, params.content)
            return {
              title: params.name,
              metadata: {},
              output: `Stored memory '${params.name}' (${params.content.length} chars)`,
            }
          }

          const exists = yield* fs.existsSafe(target)
          if (!exists) throw new Error(`memory not found: ${params.name}`)
          yield* fs.remove(target)
          return { title: params.name, metadata: {}, output: `Deleted memory '${params.name}'` }
        }).pipe(Effect.orDie),
    }
  }),
)
