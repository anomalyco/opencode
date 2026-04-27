// dependency_graph tool — extract imports and exports from a source file

import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { Service as AstParserService } from "../ast/parser"
import type { SupportedLanguage } from "../ast/languages"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Bom from "@/util/bom"

const ActionSchema = Schema.Union([Schema.Literal("imports"), Schema.Literal("exports")])

export const Parameters = Schema.Struct({
  action: ActionSchema.annotate({
    description: "imports — list what this file imports. exports — list what this file exports.",
  }),
  filePath: Schema.String.annotate({
    description: "Absolute path to the source file to analyze.",
  }),
})

function importQueries(language: SupportedLanguage): string[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return ["(import_statement source: (string) @path) @import"]
    case "python":
      return [
        "(import_statement (dotted_name) @path) @import",
        "(import_from_statement module_name: (dotted_name) @path) @import",
      ]
    case "go":
      return ["(import_spec path: (interpreted_string_literal) @path) @import"]
    case "rust":
      return [
        "(use_declaration argument: (scoped_use_list) @path) @import",
        "(use_declaration argument: (identifier) @path) @import",
      ]
    case "ruby":
      return ["(call method: (identifier) @method (#match? @method \"^(require|require_relative|load)$\") arguments: (argument_list (string) @path)) @import"]
    default:
      return []
  }
}

function exportQueries(language: SupportedLanguage): string[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return [
        "(export_statement declaration: (function_declaration name: (identifier) @name)) @export",
        "(export_statement declaration: (class_declaration name: (type_identifier) @name)) @export",
        "(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name))) @export",
        "(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @export",
      ]
    case "python":
      return [
        "(expression_statement (assignment left: (identifier) @name)) @export",
        "(function_definition name: (identifier) @name) @export",
        "(class_definition name: (identifier) @name) @export",
      ]
    case "go":
      return [
        "(function_declaration name: (identifier) @name) @export",
        "(method_declaration name: (field_identifier) @name) @export",
        "(type_declaration (type_spec name: (type_identifier) @name)) @export",
      ]
    case "rust":
      return [
        "(function_item name: (identifier) @name) @export",
        "(struct_item name: (type_identifier) @name) @export",
        "(trait_item name: (type_identifier) @name) @export",
        "(impl_item type: (type_identifier) @name) @export",
      ]
    case "java":
      return [
        "(method_declaration name: (identifier) @name) @export",
        "(class_declaration name: (identifier) @name) @export",
      ]
    case "ruby":
      return [
        "(method name: (identifier) @name) @export",
        "(class name: (constant) @name) @export",
      ]
    default:
      return []
  }
}

export const DependencyGraphTool = Tool.define(
  "dependency_graph",
  Effect.gen(function* () {
    const astParser = yield* AstParserService
    const afs = yield* AppFileSystem.Service

    const execute = (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Record<string, unknown>>, never, never> =>
      Effect.gen(function* () {
        const filePath = path.isAbsolute(params.filePath)
          ? params.filePath
          : path.join(Instance.directory, params.filePath)
        yield* assertExternalDirectoryEffect(ctx, filePath)

        yield* ctx.ask({
          permission: "read",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: {},
        })

        const source = yield* Bom.readFile(afs, filePath)
        const language = (yield* astParser.parse(filePath, source.text)).language

        if (params.action === "imports") {
          const queries = importQueries(language)
          const paths = new Set<string>()
          for (const q of queries) {
            const matches = yield* astParser.queryFile(filePath, source.text, q, language, false)
            for (const m of matches) {
              if (m.text_preview) paths.add(m.text_preview.replace(/['"]/g, ""))
            }
          }
          const list = Array.from(paths)
          return {
            title: `Imports in ${path.relative(Instance.worktree, filePath)} (${list.length})`,
            output: list.join("\n") || "No imports found.",
            metadata: { imports: list },
          }
        }

        const queries = exportQueries(language)
        const names: string[] = []
        for (const q of queries) {
          const matches = yield* astParser.queryFile(filePath, source.text, q, language, false)
          for (const m of matches) {
            if (m.name && !names.includes(m.name)) names.push(m.name)
          }
        }
        return {
          title: `Exports in ${path.relative(Instance.worktree, filePath)} (${names.length})`,
          output: names.join("\n") || "No exports found.",
          metadata: { exports: names },
        }
      }).pipe(Effect.orDie)

    return {
      description:
        "List the imports or exports of a source file. " +
        "Use this to understand file dependencies without reading the entire file.",
      parameters: Parameters,
      execute,
    }
  }),
)
