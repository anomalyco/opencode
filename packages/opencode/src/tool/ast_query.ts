// ast_query tool — semantic symbol search via web-tree-sitter

import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "../project/instance"
import { Service as AstParserService } from "../ast/parser"
import type { SupportedLanguage } from "../ast/languages"
import * as Bom from "@/util/bom"
import DESCRIPTION from "./ast_query.txt"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute path to the file to query." }),
  pattern: Schema.String.annotate({
    description:
      "A tree-sitter S-expression query pattern. " +
      'Examples: "(function_declaration) @fn" "(class_declaration) @cls" ' +
      '"(import_statement) @imp" "(variable_declarator) @var". ' +
      "Use named capture (@name) to mark the node you want returned.",
  }),
  language: Schema.optional(
    Schema.Union(
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
    ),
  ).annotate({
    description: "Override language detection. If omitted, language is inferred from file extension.",
  }),
})

export const AstQueryTool = Tool.define(
  "ast_query",
  Effect.gen(function* () {
    const afs = yield* AppFileSystem.Service
    const astParser = yield* AstParserService

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)

          const source = yield* Bom.readFile(afs, filePath)
          // Forward explicit language override so the param actually takes effect
          const matches = yield* astParser.queryFile(
            filePath,
            source.text,
            params.pattern,
            params.language as SupportedLanguage | undefined,
          )

          if (matches.length === 0) {
            return {
              title: `ast_query: no matches in ${path.relative(Instance.worktree, filePath)}`,
              output: `No nodes matched pattern: ${params.pattern}`,
              metadata: { matches: [] },
            }
          }

          const lines = matches
            .map(
              (m) =>
                `L${m.start_line + 1}-${m.end_line + 1} [${m.node_type}]${
                  m.name ? ` "${m.name}"` : ""
                }: ${m.text_preview}`,
            )
            .join("\n")

          return {
            title: `${path.relative(Instance.worktree, filePath)} — ${matches.length} match${matches.length !== 1 ? "es" : ""}`,
            output: lines,
            metadata: { matches },
          }
        }),
    }
  }),
)
