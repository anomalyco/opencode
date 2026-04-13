import path from "path"
import z from "zod"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Ripgrep } from "../file/ripgrep"
import { Filesystem } from "../util/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import { Tool } from "./tool"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        pattern: z.string().describe("The regex pattern to search for in file contents"),
        path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
        include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
      }),
      execute: (params: { pattern: string; path?: string; include?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          yield* ctx.ask({
            permission: "grep",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              include: params.include,
            },
          })

          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          yield* assertExternalDirectoryEffect(ctx, search, { kind: "directory" })

          const matches = []
          for (const match of yield* rg.search({
            cwd: search,
            pattern: params.pattern,
            glob: params.include ? [params.include] : undefined,
            signal: ctx.abort,
          })) {
            const file = path.resolve(search, match.path.text)
            const stats = Filesystem.stat(file)
            if (!stats) continue
            matches.push({
              path: file,
              mtime: stats.mtime.getTime(),
              line: match.line_number,
              text: match.lines.text,
            })
          }

          matches.sort((a, b) => b.mtime - a.mtime)

          const limit = 100
          const truncated = matches.length > limit
          const final = truncated ? matches.slice(0, limit) : matches
          if (final.length === 0) {
            return {
              title: params.pattern,
              metadata: { matches: 0, truncated: false },
              output: "No files found",
            }
          }

          const total = matches.length
          const output = [`Found ${total} matches${truncated ? ` (showing first ${limit})` : ""}`]

          let current = ""
          for (const match of final) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            const text =
              match.text.length > MAX_LINE_LENGTH ? match.text.substring(0, MAX_LINE_LENGTH) + "..." : match.text
            output.push(`  Line ${match.line}: ${text}`)
          }

          if (truncated) {
            output.push("")
            output.push(
              `(Results truncated: showing ${limit} of ${total} matches (${total - limit} hidden). Consider using a more specific path or pattern.)`,
            )
          }

          return {
            title: params.pattern,
            metadata: {
              matches: total,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
