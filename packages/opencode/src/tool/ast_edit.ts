// ast_edit tool — replace an AST node matched by a tree-sitter query

import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "../project/instance"
import { Service as AstParserService } from "../ast/parser"
import type { SupportedLanguage } from "../ast/languages"
import * as Bom from "@/util/bom"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import { trimDiff } from "./edit"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"

const LanguageSchema = Schema.Union([
  Schema.Literal("typescript"),
  Schema.Literal("tsx"),
  Schema.Literal("javascript"),
  Schema.Literal("python"),
  Schema.Literal("bash"),
  Schema.Literal("go"),
  Schema.Literal("rust"),
  Schema.Literal("ruby"),
  Schema.Literal("java"),
  Schema.Literal("c"),
  Schema.Literal("cpp"),
  Schema.Literal("css"),
  Schema.Literal("html"),
  Schema.Literal("json"),
  Schema.Literal("yaml"),
  Schema.Literal("toml"),
])

type AstEditMetadata = {
  diff?: string | undefined
  filediff?: Snapshot.FileDiff | undefined
  diagnostics?: Record<string, unknown> | undefined
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Absolute path to the file to edit.",
  }),
  pattern: Schema.String.annotate({
    description:
      "A tree-sitter S-expression query that captures the node to replace. " +
      'Example: "(function_declaration name: (identifier) @name (#eq? @name \"myFunc\")) @fn". ' +
      "When multiple nodes match, the one with the largest source span is replaced.",
  }),
  newContent: Schema.String.annotate({
    description: "The complete new source text to substitute for the matched node.",
  }),
  language: Schema.optional(LanguageSchema).annotate({
    description: "Override language detection. Inferred from file extension when omitted.",
  }),
})

export const AstEditTool = Tool.define(
  "ast_edit",
  Effect.gen(function* () {
    const afs       = yield* AppFileSystem.Service
    const astParser = yield* AstParserService
    const format    = yield* Format.Service
    const bus       = yield* Bus.Service
    const lsp       = yield* LSP.Service

    const execute = (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<AstEditMetadata>, never, never> =>
      Effect.gen(function* () {
        const filePath = path.isAbsolute(params.filePath)
          ? params.filePath
          : path.join(Instance.directory, params.filePath)
        yield* assertExternalDirectoryEffect(ctx, filePath)

        const source  = yield* Bom.readFile(afs, filePath)
        const content = source.text

        const matches = yield* astParser.queryFile(
          filePath,
          content,
          params.pattern,
          params.language as SupportedLanguage | undefined,
          true,
        )

        if (matches.length === 0)
          return {
            title:  `ast_edit: no match in ${path.relative(Instance.worktree, filePath)}`,
            output: `No node matched pattern: ${params.pattern}`,
            metadata: { diff: undefined, filediff: undefined, diagnostics: undefined },
          }

        const match = matches.reduce((best, m) =>
          (m.end_index - m.start_index) > (best.end_index - best.start_index) ? m : best
        )

        // Use the UTF-16 character offsets directly — tree-sitter's startIndex/endIndex
        // are UTF-16 code-unit offsets, identical to JavaScript's String.prototype.slice().
        const newContent = content.slice(0, match.start_index) + params.newContent + content.slice(match.end_index)

        const diff = trimDiff(createTwoFilesPatch(filePath, filePath, content, newContent))

        yield* ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: { filepath: filePath, diff },
        })

        yield* afs.writeWithDirs(filePath, Bom.join(newContent, source.bom))
        if (yield* format.file(filePath)) yield* Bom.syncFile(afs, filePath, source.bom)

        yield* bus.publish(File.Event.Edited, { file: filePath })
        yield* bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })

        const { additions, deletions } = diffLines(content, newContent).reduce(
          (acc, c) => ({
            additions: acc.additions + (c.added ? c.count ?? 0 : 0),
            deletions: acc.deletions + (c.removed ? c.count ?? 0 : 0),
          }),
          { additions: 0, deletions: 0 },
        )
        const filediff: Snapshot.FileDiff = { file: filePath, patch: diff, additions, deletions }

        yield* ctx.metadata({ metadata: { diff, filediff, diagnostics: {} } })

        yield* lsp.touchFile(filePath, "document")
        const diagnostics = yield* lsp.diagnostics()
        const block = LSP.Diagnostic.report(
          filePath,
          diagnostics[AppFileSystem.normalizePath(filePath)] ?? [],
        )

        return {
          title:  `ast_edit: ${path.relative(Instance.worktree, filePath)} L${match.start_line + 1}-${match.end_line + 1}`,
          output: block ? `Edit applied.\n\nLSP errors detected, please fix:\n${block}` : "Edit applied.",
          metadata: { diff, filediff, diagnostics },
        }
      }).pipe(Effect.orDie)

    return {
      description:
        "Edit a source file by replacing the AST node matched by a tree-sitter query. " +
        "Use ast_query first to identify the exact pattern, then call ast_edit to apply the replacement. " +
        "When multiple nodes match, the largest-span node is replaced.",
      parameters: Parameters,
      execute,
    }
  }),
)
