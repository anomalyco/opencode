import { Schema } from "effect"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import * as LSPClient from "@/lsp/client"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { trimDiff } from "./edit"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Bom from "@/util/bom"

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
})

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          const source = exists ? yield* Bom.readFile(fs, filepath) : { bom: false, text: "" }
          const next = Bom.split(params.content)
          const desiredBom = source.bom || next.bom
          const contentOld = source.text
          const contentNew = next.text

          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, contentNew))
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
            },
          })

          yield* fs.writeWithDirs(filepath, Bom.join(contentNew, desiredBom))

          // Post-write side-effects: format, BOM sync, bus publish, LSP.
          // These must NOT fail the tool — the bytes are already on disk and
          // the model needs to know that. Previously a throw in any of these
          // (e.g. LSP server stalling on a large file, formatter OOM, BOM
          // re-read race) would propagate through `Effect.orDie` and surface
          // to the user as a silent abort with no error message.
          // See: https://github.com/anomalyco/opencode/issues/19604
          yield* Effect.gen(function* () {
            if (yield* format.file(filepath)) {
              yield* Bom.syncFile(fs, filepath, desiredBom)
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("write: post-write format/BOM step failed (file already written)", { cause }),
            ),
          )
          yield* bus
            .publish(File.Event.Edited, { file: filepath })
            .pipe(Effect.catchCause((cause) => Effect.logWarning("write: bus publish File.Edited failed", { cause })))
          yield* bus
            .publish(FileWatcher.Event.Updated, {
              file: filepath,
              event: exists ? "change" : "add",
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("write: bus publish FileWatcher.Updated failed", { cause }),
              ),
            )

          let output = "Wrote file successfully."
          yield* lsp
            .touchFile(filepath, "document")
            .pipe(Effect.catchCause((cause) => Effect.logWarning("write: lsp.touchFile failed", { cause })))
          const diagnostics: Record<string, LSPClient.Diagnostic[]> = yield* lsp.diagnostics().pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logWarning("write: lsp.diagnostics failed", { cause })
                return {} as Record<string, LSPClient.Diagnostic[]>
              }),
            ),
          )
          const normalizedFilepath = AppFileSystem.normalizePath(filepath)
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? filepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }

          return {
            title: path.relative(instance.worktree, filepath),
            metadata: {
              diagnostics,
              filepath,
              exists: exists,
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
