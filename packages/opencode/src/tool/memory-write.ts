import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import { buildPath, resolveProjectId, type Scope } from "../memory/paths"

const DESCRIPTION = [
  "Persist a markdown note into memory so it can be recalled later with the `memory` tool (BM25 search).",
  "",
  "Layout: <data>/memory/<scope>/<scope_id>/<key>.md",
  "Scopes:",
  "- global: shared across all projects/sessions (scope_id is empty)",
  "- projects: scoped to the current project (scope_id derived automatically)",
  "- sessions: scoped to the current session (scope_id is the session id)",
  "",
  "Use a stable `key` (e.g. 'memory', 'checkpoint', 'notes/db-setup') so related notes group together.",
  "Set `append=true` to add to an existing note instead of overwriting it.",
].join("\n")

export const Parameters = Schema.Struct({
  key: Schema.String.annotate({
    description: "File key under the scope, without extension (e.g. 'memory', 'notes/db-setup')",
  }),
  content: Schema.String.annotate({ description: "Markdown content to write" }),
  scope: Schema.optional(Schema.Literals(["global", "projects", "sessions"])).annotate({
    description: "Memory scope. Defaults to 'global'.",
  }),
  append: Schema.optional(Schema.Boolean).annotate({
    description: "Append to the existing note instead of overwriting (default false).",
  }),
})

export const MemoryWriteTool = Tool.define(
  "memory_write",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const scope: Scope = args.scope ?? "global"
          const scope_id =
            scope === "global" ? "" : scope === "sessions" ? String(ctx.sessionID) : resolveProjectId(ins.worktree)

          const root = path.join(Global.Path.data, "memory")
          const target = buildPath({ root, scope, scope_id, key: args.key })

          yield* ctx.ask({
            permission: "memory_write",
            patterns: [`${scope}/${args.key}`],
            always: ["*"],
            metadata: { scope, scope_id, key: args.key },
          })

          let content = args.content
          if (args.append) {
            const existing = yield* fs.readFileStringSafe(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (existing !== undefined && existing.length > 0) {
              content = existing.replace(/\s*$/, "") + "\n\n" + args.content
            }
          }
          if (!content.endsWith("\n")) content += "\n"

          yield* fs.writeWithDirs(target, content).pipe(Effect.orDie)

          return {
            title: `memory ${scope}/${args.key}`,
            metadata: { path: target, scope, scope_id, key: args.key, append: args.append === true },
            output: `${args.append ? "Appended to" : "Wrote"} memory note: ${target}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
