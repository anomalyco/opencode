// ast_edit tool — replace an AST node by line range (byte-offset precise)
// Companion to ast_query: takes start_line/end_line from a query result.

import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./ast_edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Bom from "@/util/bom"
import { trimDiff } from "./edit"
import { AstParser } from "../ast/parser"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute path to the file to edit." }),
  start_line: Schema.Number.annotate({
    description: "0-indexed start line of the AST node to replace (from ast_query result).",
  }),
  end_line: Schema.Number.annotate({
    description: "0-indexed end line of the AST node to replace (inclusive).",
  }),
  replacement: Schema.String.annotate({
    description: "The new source text to replace the matched AST node with. Must be syntactically valid.",
  }),
  verify_node_type: Schema.optional(Schema.String).annotate({
    description:
      "Optional: the expected node_type at this range (e.g. 'function_declaration'). " +
      "If provided and the actual node type differs, the edit is aborted as a safety check.",
  }),
})

export const AstEditTool = Tool.define(
  "ast_edit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service
    const astParser = yield* AstParser.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)

          const source = yield* Bom.readFile(afs, filePath)
          const content = source.text

          // Parse the file to locate the exact byte range of the target node
          const parsed = yield* astParser.parse(filePath, content)
          const nodeInfo = yield* astParser.nodeAtRange(parsed, params.start_line, params.end_line)

          if (!nodeInfo) {
            throw new Error(
              `ast_edit: no AST node found spanning lines ${params.start_line}-${params.end_line} in ` +
                path.relative(Instance.worktree, filePath) +
                ". Re-run ast_query to verify the line range.",
            )
          }

          // Optional node type safety check
          if (params.verify_node_type && nodeInfo.node_type !== params.verify_node_type) {
            throw new Error(
              `ast_edit: expected node type "${params.verify_node_type}" but found "${nodeInfo.node_type}" ` +
                `at lines ${params.start_line}-${params.end_line}. ` +
                "Re-run ast_query to get the correct range and node type.",
            )
          }

          // Apply replacement using byte offsets — immune to indentation/whitespace drift
          const encoder = new TextEncoder()
          const decoder = new TextDecoder()
          const bytes = encoder.encode(content)
          const before = bytes.slice(0, nodeInfo.start_byte)
          const after = bytes.slice(nodeInfo.end_byte)
          const replacementBytes = encoder.encode(params.replacement)
          const newBytes = new Uint8Array(before.length + replacementBytes.length + after.length)
          newBytes.set(before, 0)
          newBytes.set(replacementBytes, before.length)
          newBytes.set(after, before.length + replacementBytes.length)
          const contentNew = decoder.decode(newBytes)

          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, content, contentNew))

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, filePath)],
            always: ["*"],
            metadata: { filepath: filePath, diff },
          })

          const next = Bom.split(contentNew)
          const desiredBom = source.bom || next.bom
          yield* afs.writeWithDirs(filePath, Bom.join(next.text, desiredBom))

          if (yield* format.file(filePath)) {
            yield* Bom.syncFile(afs, filePath, desiredBom)
          }
          yield* bus.publish(File.Event.Edited, { file: filePath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })

          let additions = 0
          let deletions = 0
          for (const change of diffLines(content, contentNew)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }
          const filediff: Snapshot.FileDiff = { file: filePath, patch: diff, additions, deletions }

          yield* ctx.metadata({ metadata: { diff, filediff, diagnostics: {} } })

          let output =
            `Replaced ${nodeInfo.node_type}` +
            (nodeInfo.name ? ` "${nodeInfo.name}"` : "") +
            ` at lines ${params.start_line + 1}-${params.end_line + 1}.`

          yield* lsp.touchFile(filePath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected, please fix:\n${block}`

          return {
            metadata: { diagnostics, diff, filediff },
            title: `${path.relative(Instance.worktree, filePath)} — ${nodeInfo.node_type}${nodeInfo.name ? ` "${nodeInfo.name}"` : ""} L${params.start_line + 1}-${params.end_line + 1}`,
            output,
          }
        }),
    }
  }),
)
