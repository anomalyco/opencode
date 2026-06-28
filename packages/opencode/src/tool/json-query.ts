import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Query a JSON file with a simple path and return the matched value as JSON.",
  "",
  "Path syntax: dot/bracket access, e.g. `dependencies`, `scripts.build`, `items[0].name`, `a.b[2]`.",
  "Pass an empty path (or omit it) to return the whole document.",
  "Cheaper and more precise than reading a large JSON file and parsing it by eye.",
].join("\n")

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute or relative path to the JSON file" }),
  path: Schema.optional(Schema.String).annotate({
    description: "Path into the document (e.g. 'scripts.build', 'items[0].name'). Omit for the whole document.",
  }),
})

function tokenize(query: string): (string | number)[] {
  const tokens: (string | number)[] = []
  // Normalize bracket indices (`[0]` -> `.0`) then split on dots.
  for (const raw of query.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    const seg = raw.trim()
    if (!seg) continue
    tokens.push(/^\d+$/.test(seg) ? Number.parseInt(seg, 10) : seg)
  }
  return tokens
}

function resolve(value: unknown, tokens: (string | number)[]): unknown {
  let current = value
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined
    if (typeof token === "number") {
      if (!Array.isArray(current)) return undefined
      current = current[token]
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined
      current = (current as Record<string, unknown>)[token]
    }
  }
  return current
}

export const JsonQueryTool = Tool.define(
  "json_query",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const file = path.isAbsolute(args.filePath)
            ? args.filePath
            : path.join(SessionCwd.get(ctx.sessionID, ins.directory), args.filePath)

          yield* assertExternalDirectoryEffect(ctx, file)
          yield* ctx.ask({
            permission: "read",
            patterns: [path.relative(ins.worktree, file)],
            always: ["*"],
            metadata: { path: args.path },
          })

          const raw = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (raw === undefined) throw new Error(`File not found: ${file}`)

          const parsed = ((): unknown => {
            try {
              return JSON.parse(raw)
            } catch (err) {
              throw new Error(`Invalid JSON in ${file}: ${(err as Error).message}`)
            }
          })()

          const tokens = args.path ? tokenize(args.path) : []
          const result = tokens.length === 0 ? parsed : resolve(parsed, tokens)

          if (result === undefined) {
            return {
              title: `json_query: no match`,
              metadata: { found: false },
              output: `No value at path "${args.path ?? ""}".`,
            }
          }

          return {
            title: `json_query ${args.path ?? "(root)"}`,
            metadata: { found: true },
            output: JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
