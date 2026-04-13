import z from "zod"
import { Effect, Option } from "effect"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"
import { AppFileSystem } from "../filesystem"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectoryEffect } from "./external-directory"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
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

          let searchPath = params.path ?? Instance.directory
          searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
          yield* assertExternalDirectoryEffect(ctx, searchPath, { kind: "directory" })

          const result = yield* rg.search({
            cwd: searchPath,
            pattern: params.pattern,
            glob: params.include ? [params.include] : undefined,
          })

          if (result.items.length === 0) {
            return {
              title: params.pattern,
              metadata: { matches: 0, truncated: false },
              output: "No files found",
            }
          }

          const matches = (yield* Effect.forEach(
            result.items,
            Effect.fnUntraced(function* (item) {
              const file = path.isAbsolute(item.path.text) ? item.path.text : path.resolve(searchPath, item.path.text)
              const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!info || info.type === "Directory") return []

              return [
                {
                  path: file,
                  mtime:
                    info.mtime.pipe(
                      Option.map((time) => time.getTime()),
                      Option.getOrElse(() => 0),
                    ) ?? 0,
                  line: item.line_number,
                  text: item.lines.text,
                },
              ]
            }),
            { concurrency: "unbounded" },
          )).flat()

          matches.sort((a, b) => b.mtime - a.mtime)

          const limit = 100
          const truncated = matches.length > limit
          const finalMatches = truncated ? matches.slice(0, limit) : matches

          if (finalMatches.length === 0) {
            return {
              title: params.pattern,
              metadata: { matches: 0, truncated: false },
              output: "No files found",
            }
          }

          const totalMatches = matches.length
          const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

          let currentFile = ""
          for (const match of finalMatches) {
            if (currentFile !== match.path) {
              if (currentFile !== "") {
                outputLines.push("")
              }
              currentFile = match.path
              outputLines.push(`${match.path}:`)
            }
            const truncatedLineText =
              match.text.length > MAX_LINE_LENGTH ? match.text.substring(0, MAX_LINE_LENGTH) + "..." : match.text
            outputLines.push(`  Line ${match.line}: ${truncatedLineText}`)
          }

          if (truncated) {
            outputLines.push("")
            outputLines.push(
              `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
            )
          }

          if (result.partial) {
            outputLines.push("")
            outputLines.push("(Some paths were inaccessible and skipped)")
          }

          return {
            title: params.pattern,
            metadata: {
              matches: totalMatches,
              truncated,
            },
            output: outputLines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
