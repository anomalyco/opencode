import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Render a directory tree (respecting .gitignore) in a single call.",
  "Cheaper than multiple glob/read calls when you want a quick structural overview.",
  "Relative `path` resolves against the session working directory (see change_directory).",
].join("\n")

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Directory to render. Defaults to the session working directory.",
  }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Max depth to display (default 4)" }),
})

type Node = { dirs: Map<string, Node>; files: string[] }

function emptyNode(): Node {
  return { dirs: new Map(), files: [] }
}

function render(node: Node, prefix: string, depth: number, maxDepth: number, out: string[]): void {
  if (depth > maxDepth) return
  const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
  const files = [...node.files].sort((a, b) => a.localeCompare(b))
  const entries = [...dirNames.map((n) => ({ name: n, dir: true })), ...files.map((n) => ({ name: n, dir: false }))]
  entries.forEach((entry, idx) => {
    const last = idx === entries.length - 1
    const branch = last ? "└── " : "├── "
    out.push(`${prefix}${branch}${entry.name}${entry.dir ? "/" : ""}`)
    if (entry.dir) {
      const child = node.dirs.get(entry.name)!
      render(child, prefix + (last ? "    " : "│   "), depth + 1, maxDepth, out)
    }
  })
}

export const TreeTool = Tool.define(
  "tree",
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const base = SessionCwd.get(ctx.sessionID, ins.directory)
          const root = args.path
            ? path.isAbsolute(args.path)
              ? args.path
              : path.resolve(base, args.path)
            : base
          const maxDepth = args.depth ?? 4

          yield* assertExternalDirectoryEffect(ctx, root, { kind: "directory" })

          const limit = 1000
          const entries = yield* ripgrep
            .glob({ cwd: root, pattern: "**/*", limit })
            .pipe(Effect.catch(() => Effect.succeed([])))

          const tree = emptyNode()
          for (const entry of entries) {
            const rel = entry.path.replaceAll("\\", "/")
            const segments = rel.split("/").filter(Boolean)
            if (segments.length === 0) continue
            let cur = tree
            for (let i = 0; i < segments.length - 1; i++) {
              const seg = segments[i]
              let next = cur.dirs.get(seg)
              if (!next) {
                next = emptyNode()
                cur.dirs.set(seg, next)
              }
              cur = next
            }
            cur.files.push(segments[segments.length - 1])
          }

          const out: string[] = [path.relative(ins.worktree, root) || "."]
          render(tree, "", 1, maxDepth, out)
          const truncated = entries.length === limit
          if (truncated) out.push("", `(truncated at ${limit} entries)`)

          return {
            title: path.relative(ins.worktree, root) || ".",
            metadata: { count: entries.length, truncated },
            output: out.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
