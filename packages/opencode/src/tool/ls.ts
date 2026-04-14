import * as path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./ls.txt"
import { Tool } from "./tool"

export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "vendor/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LIMIT = 100

export const ListTool = Tool.define(
  "list",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        path: z
          .string()
          .describe("The absolute path to the directory to list (must be absolute, not relative)")
          .optional(),
        ignore: z.array(z.string()).describe("List of glob patterns to ignore").optional(),
      }),
      execute: (params: { path?: string; ignore?: string[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const search = path.resolve(ins.directory, params.path || ".")
          yield* assertExternalDirectoryEffect(ctx, search, { kind: "directory" })

          yield* ctx.ask({
            permission: "list",
            patterns: [search],
            always: ["*"],
            metadata: {
              path: search,
            },
          })

          const glob = IGNORE_PATTERNS.map((item) => `!${item}*`).concat(params.ignore?.map((item) => `!${item}`) || [])
          const files = yield* rg.files({ cwd: search, glob, signal: ctx.abort }).pipe(
            Stream.take(LIMIT + 1),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk]),
          )

          const truncated = files.length > LIMIT
          if (truncated) files.length = LIMIT

          const dirs = new Set<string>()
          const map = new Map<string, string[]>()
          for (const file of files) {
            const dir = path.dirname(file)
            const parts = dir === "." ? [] : dir.split("/")
            for (let i = 0; i <= parts.length; i++) {
              dirs.add(i === 0 ? "." : parts.slice(0, i).join("/"))
            }
            if (!map.has(dir)) map.set(dir, [])
            map.get(dir)!.push(path.basename(file))
          }

          function render(dir: string, depth: number): string {
            const indent = "  ".repeat(depth)
            let output = ""
            if (depth > 0) output += `${indent}${path.basename(dir)}/\n`

            const child = "  ".repeat(depth + 1)
            const dirs2 = Array.from(dirs)
              .filter((item) => path.dirname(item) === dir && item !== dir)
              .sort()
            for (const item of dirs2) {
              output += render(item, depth + 1)
            }

            const files = map.get(dir) || []
            for (const file of files.sort()) {
              output += `${child}${file}\n`
            }
            return output
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: `${search}/\n` + render(".", 0),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
