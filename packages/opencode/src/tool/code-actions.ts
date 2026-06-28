import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import { applyWorkspaceEdit } from "./apply-workspace-edit"

const DESCRIPTION = [
  "List and apply language-server code actions (quick-fixes, refactors, auto-imports) for a file/range.",
  "",
  "Without `apply`: lists the available actions with their index, title and kind.",
  "With `apply=<index>`: applies that action's edit (auto-import, fix, etc.). Actions that are pure",
  "commands (no inline edit) are reported as not directly applicable.",
  "Positions are 1-based; omit the end position to target a single point.",
  "Requires an LSP server for the file's language.",
].join("\n")

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: "Start line (1-based)" }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: "Start character (1-based)" }),
  endLine: Schema.optional(Schema.Int).annotate({ description: "End line (1-based). Defaults to start line." }),
  endCharacter: Schema.optional(Schema.Int).annotate({
    description: "End character (1-based). Defaults to start character.",
  }),
  apply: Schema.optional(Schema.Int).annotate({ description: "Index of the action to apply (from the list)." }),
})

type Action = { title?: string; kind?: string; edit?: unknown; command?: unknown }

export const CodeActionsTool = Tool.define(
  "code_actions",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

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
            permission: args.apply !== undefined ? "edit" : "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: { filePath: file, line: args.line, character: args.character, apply: args.apply },
          })

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)
          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const actions = (yield* lsp.codeAction({
            file,
            line: args.line - 1,
            character: args.character - 1,
            endLine: (args.endLine ?? args.line) - 1,
            endCharacter: (args.endCharacter ?? args.character) - 1,
          })) as Action[]

          if (actions.length === 0) {
            return { title: "code_actions: 0", metadata: { count: 0, changed: 0 }, output: "No code actions available here." }
          }

          if (args.apply === undefined) {
            const lines = [`${actions.length} code action(s):`, ""]
            actions.forEach((a, i) => {
              const kind = a.kind ? ` [${a.kind}]` : ""
              const applicable = a.edit ? "" : " (command — not directly applicable)"
              lines.push(`${i}. ${a.title ?? "(untitled)"}${kind}${applicable}`)
            })
            lines.push("", "Re-run with apply=<index> to apply one with an edit.")
            return { title: `code_actions: ${actions.length}`, metadata: { count: actions.length, changed: 0 }, output: lines.join("\n") }
          }

          const chosen = actions[args.apply]
          if (!chosen) throw new Error(`Invalid action index ${args.apply} (have ${actions.length}).`)
          if (!chosen.edit) {
            return {
              title: `code_actions: not applicable`,
              metadata: { count: actions.length, changed: 0 },
              output: `Action "${chosen.title ?? args.apply}" has no inline edit (it is a command) and cannot be applied directly.`,
            }
          }

          const changed = yield* applyWorkspaceEdit(chosen.edit, fs, events)
          const rels = changed.map((f) => path.relative(ins.worktree, f))
          return {
            title: `code_actions: applied "${chosen.title ?? args.apply}"`,
            metadata: { count: actions.length, changed: changed.length },
            output:
              changed.length === 0
                ? "Action applied but produced no file changes."
                : [`Applied "${chosen.title ?? args.apply}" to ${changed.length} file(s):`, ...rels.map((r) => `  ${r}`)].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
