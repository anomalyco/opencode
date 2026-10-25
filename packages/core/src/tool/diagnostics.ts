import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import type { LSPClient } from "@/lsp/client"
import DESCRIPTION from "./diagnostics.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@bolt-ai/core/fs-util"

const severities = ["error", "warning", "info", "hint"] as const
export type Severity = (typeof severities)[number]

export function label(value: number | undefined): Severity {
  if (value === 2) return "warning"
  if (value === 3) return "info"
  if (value === 4) return "hint"
  return "error"
}

export function within(file: string, root: string) {
  if (file === root) return true
  const relative = path.relative(root, file)
  if (!relative) return true
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function filter(all: Record<string, LSPClient.Diagnostic[]>, options: { path?: string; severity?: Severity }) {
  const result: Record<string, LSPClient.Diagnostic[]> = {}
  for (const file of Object.keys(all).sort()) {
    if (options.path && !within(file, options.path)) continue
    const items = all[file]
      .filter((item) => !options.severity || label(item.severity) === options.severity)
      .toSorted((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
    if (items.length === 0) continue
    result[file] = items
  }
  return result
}

export function format(file: string, diagnostic: LSPClient.Diagnostic) {
  const line = diagnostic.range.start.line + 1
  const column = diagnostic.range.start.character + 1
  const source = diagnostic.source ? ` [${diagnostic.source}]` : ""
  return `${file}:${line}:${column} ${label(diagnostic.severity)} ${diagnostic.message}${source}`
}

export function render(diagnostics: Record<string, LSPClient.Diagnostic[]>) {
  const files = Object.keys(diagnostics)
  const total = files.reduce((sum, file) => sum + diagnostics[file].length, 0)
  if (total === 0) return "No diagnostics found."
  const lines = files.flatMap((file) => diagnostics[file].map((item) => format(file, item)))
  const summary = `${total} diagnostic${total === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}:`
  return [summary, ...lines].join("\n")
}

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description:
      "File or directory to scope diagnostics to. A file is refreshed in the language server before reporting. Defaults to the whole project.",
  }),
  severity: Schema.optional(Schema.Literals(severities)).annotate({
    description: "Only report diagnostics with this severity: error, warning, info, or hint.",
  }),
})

export const DiagnosticsTool = Tool.define(
  "diagnostics",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const target = args.path
            ? path.isAbsolute(args.path)
              ? args.path
              : path.join(instance.directory, args.path)
            : undefined
          if (target) yield* assertExternalDirectoryEffect(ctx, target)

          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: {
              operation: "diagnostics",
              ...(target ? { path: target } : {}),
              ...(args.severity ? { severity: args.severity } : {}),
            },
          })

          if (target) {
            const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!info) throw new Error(`Path not found: ${target}`)
            if (info.type === "File") yield* lsp.touchFile(target, "full")
          }

          const all = yield* lsp.diagnostics()
          const scoped = filter(all, { path: target, severity: args.severity })
          const relative: Record<string, LSPClient.Diagnostic[]> = {}
          for (const file of Object.keys(scoped)) {
            relative[path.relative(instance.worktree, file) || file] = scoped[file]
          }

          const files = Object.keys(relative)
          const total = files.reduce((sum, file) => sum + relative[file].length, 0)
          const detail = target ? path.relative(instance.worktree, target) || target : ""
          return {
            title: detail ? `diagnostics ${detail}` : "diagnostics",
            metadata: { files: files.length, total },
            output: render(relative),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
