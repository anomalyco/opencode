import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./multiedit.txt"
import { FileSystem } from "@bolt-ai/core/filesystem"
import { Watcher } from "@bolt-ai/core/filesystem/watcher"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@bolt-ai/core/fs-util"
import * as Bom from "@/util/bom"
import { lock, replace, trimDiff } from "./edit"

function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function ending(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convert(text: string, eol: "\n" | "\r\n"): string {
  if (eol === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  edits: Schema.Array(
    Schema.Struct({
      oldString: Schema.String.annotate({ description: "The text to replace" }),
      newString: Schema.String.annotate({
        description: "The text to replace it with (must be different from oldString)",
      }),
      replaceAll: Schema.optional(Schema.Boolean).annotate({
        description: "Replace all occurrences of oldString (default false)",
      }),
    }),
  ).annotate({
    description: "Edits to apply in order. Each edit operates on the result of the previous one.",
  }),
})

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* FSUtil.Service
    const format = yield* Format.Service
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.filePath) {
            throw new Error("filePath is required")
          }
          if (params.edits.length === 0) {
            throw new Error("edits must contain at least one edit")
          }

          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)

          let diff = ""
          let contentOld = ""
          let contentNew = ""
          yield* lock(filePath).withPermits(1)(
            Effect.gen(function* () {
              const info = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!info) throw new Error(`File ${filePath} not found`)
              if (info.type === "Directory") throw new Error(`Path is a directory, not a file: ${filePath}`)
              const source = yield* Bom.readFile(afs, filePath)
              contentOld = source.text

              const eol = ending(contentOld)
              // Apply every edit in memory first so a failing edit leaves the file untouched.
              let content = contentOld
              for (let i = 0; i < params.edits.length; i++) {
                const edit = params.edits[i]
                try {
                  content = replace(
                    content,
                    convert(normalize(edit.oldString), eol),
                    convert(normalize(edit.newString), eol),
                    edit.replaceAll,
                  )
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err)
                  throw new Error(`Edit ${i + 1} of ${params.edits.length} failed, no changes applied: ${message}`)
                }
              }

              const next = Bom.split(content)
              const desiredBom = source.bom || next.bom
              contentNew = next.text

              diff = trimDiff(createTwoFilesPatch(filePath, filePath, normalize(contentOld), normalize(contentNew)))
              yield* ctx.ask({
                permission: "edit",
                patterns: [path.relative(instance.worktree, filePath)],
                always: ["*"],
                metadata: {
                  filepath: filePath,
                  diff,
                },
              })

              yield* afs.writeWithDirs(filePath, Bom.join(contentNew, desiredBom))
              if (yield* format.file(filePath)) {
                contentNew = yield* Bom.syncFile(afs, filePath, desiredBom)
              }
              yield* events.publish(FileSystem.Event.Edited, { file: filePath })
              yield* events.publish(Watcher.Event.Updated, {
                file: filePath,
                event: "change",
              })
              diff = trimDiff(createTwoFilesPatch(filePath, filePath, normalize(contentOld), normalize(contentNew)))
            }).pipe(Effect.orDie),
          )

          let additions = 0
          let deletions = 0
          for (const change of diffLines(contentOld, contentNew)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }
          const filediff: Snapshot.FileDiff = {
            file: filePath,
            patch: diff,
            additions,
            deletions,
          }

          yield* ctx.metadata({
            metadata: {
              diff,
              filediff,
              diagnostics: {},
            },
          })

          let output = `Applied ${params.edits.length} edit${params.edits.length === 1 ? "" : "s"} successfully.`
          yield* lsp.touchFile(filePath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = FSUtil.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            metadata: {
              diagnostics,
              diff,
              filediff,
            },
            title: `${path.relative(instance.worktree, filePath)}`,
            output,
          }
        }),
    }
  }),
)
