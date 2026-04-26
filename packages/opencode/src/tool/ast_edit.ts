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
      "A tree-sitter S-expression query that captures exactly ONE node to replace. " +
      'Example: "(function_declaration name: (identifier) @name (#eq? @name \"myFunc\")) @fn" — ' +
      "the LAST capture in the pattern is the node whose full source will be replaced.",
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

        if (matches.length > 1)
          return {
            title:  `ast_edit: ambiguous match in ${path.relative(Instance.worktree, filePath)}`,
            output:
              `Pattern matched ${matches.length} nodes. Refine the query so it captures exactly one node.\n` +
              matches
                .map((m) => `  L${m.start_line + 1}-${m.end_line + 1} [${m.node_type}]${
                  m.name ? ` "${m.name}"` : ""
                }: ${m.text_preview}`)
                .join("\n"),
            metadata: { diff: undefined, filediff: undefined, diagnostics: undefined },
          }

        const match = matches[0]!

        // Apply replacement using exact byte offsets from the parser — immune to
        // CRLF, multi-byte UTF-8, and any other encoding/line-ending concerns.
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()
        const bytes = encoder.encode(content)
        const before = bytes.slice(0, match.start_byte)
        const after = bytes.slice(match.end_byte)
        const replacementBytes = encoder.encode(params.newContent)
        const newBytes = new Uint8Array(before.length + replacementBytes.length + after.length)
        newBytes.set(before, 0)
        newBytes.set(replacementBytes, before.length)
        newBytes.set(after, before.length + replacementBytes.length)
        const newContent = decoder.decode(newBytes)

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
        "Fails if the query matches zero or more than one node.",
      parameters: Parameters,
      execute,
    }
  }),
)
