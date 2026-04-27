// symbol_index tool — extract structural skeletons or query symbols from source files

import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { Service as AstParserService } from "../ast/parser"
import type { SupportedLanguage } from "../ast/languages"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Bom from "@/util/bom"

const ActionSchema = Schema.Union([Schema.Literal("skeleton"), Schema.Literal("query")])

export const Parameters = Schema.Struct({
  action: ActionSchema.annotate({
    description:
      "skeleton — return the structural outline of a file (functions, classes, interfaces).\n" +
      "query — search for symbols matching a name pattern within a file.",
  }),
  filePath: Schema.String.annotate({
    description: "Absolute path to the source file to analyze.",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "For action=query: a symbol name or substring to search for (case-insensitive).",
  }),
})

type SymbolEntry = {
  kind: string
  name: string | null
  start_line: number
  end_line: number
}

function skeletonQueries(language: SupportedLanguage): string[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return [
        "(function_declaration name: (identifier) @name) @symbol",
        "(class_declaration name: (type_identifier) @name) @symbol",
        "(interface_declaration name: (type_identifier) @name) @symbol",
        "(method_definition name: (property_identifier) @name) @symbol",
        "(variable_declarator name: (identifier) @name value: (arrow_function)) @symbol",
      ]
    case "python":
      return [
        "(function_definition name: (identifier) @name) @symbol",
        "(class_definition name: (identifier) @name) @symbol",
      ]
    case "go":
      return [
        "(function_declaration name: (identifier) @name) @symbol",
        "(method_declaration name: (field_identifier) @name) @symbol",
        "(type_declaration (type_spec name: (type_identifier) @name)) @symbol",
      ]
    case "rust":
      return [
        "(function_item name: (identifier) @name) @symbol",
        "(struct_item name: (type_identifier) @name) @symbol",
        "(trait_item name: (type_identifier) @name) @symbol",
        "(impl_item trait: (type_identifier)? type: (type_identifier) @name) @symbol",
      ]
    case "java":
      return [
        "(method_declaration name: (identifier) @name) @symbol",
        "(class_declaration name: (identifier) @name) @symbol",
        "(interface_declaration name: (identifier) @name) @symbol",
      ]
    case "ruby":
      return [
        "(method name: (identifier) @name) @symbol",
        "(class name: (constant) @name) @symbol",
        "(module name: (constant) @name) @symbol",
      ]
    default:
      return [
        "(function_declaration name: (identifier) @name) @symbol",
      ]
  }
}

export const SymbolIndexTool = Tool.define(
  "symbol_index",
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
        const queries = skeletonQueries(language)

        const allMatches: SymbolEntry[] = []
        for (const q of queries) {
          const matches = yield* astParser.queryFile(filePath, source.text, q, language, true)
          for (const m of matches) {
            allMatches.push({
              kind: m.node_type,
              name: m.name,
              start_line: m.start_line + 1,
              end_line: m.end_line + 1,
            })
          }
        }

        // Deduplicate by start_line
        const seen = new Set<number>()
        const deduped = allMatches.filter((m) => {
          if (seen.has(m.start_line)) return false
          seen.add(m.start_line)
          return true
        })

        // Sort by start_line
        deduped.sort((a, b) => a.start_line - b.start_line)

        if (params.action === "query") {
          const term = params.query?.toLowerCase() ?? ""
          if (!term) {
            return {
              title: `symbol_index: query in ${path.relative(Instance.worktree, filePath)}`,
              output: "No query term provided. Use the 'query' parameter.",
              metadata: {},
            }
          }
          const filtered = deduped.filter((s) => s.name?.toLowerCase().includes(term))
          const lines = filtered.map((s) => `${s.kind}|${s.name ?? "?"}|L${s.start_line}-L${s.end_line}`)
          return {
            title: `symbol_index: ${filtered.length} match${filtered.length === 1 ? "" : "es"} in ${path.relative(Instance.worktree, filePath)}`,
            output: lines.join("\n") || "No matching symbols found.",
            metadata: { matches: filtered },
          }
        }

        const lines = deduped.map((s) => `${s.kind}|${s.name ?? "?"}|L${s.start_line}-L${s.end_line}`)
        return {
          title: `Skeleton: ${path.relative(Instance.worktree, filePath)} (${deduped.length} symbols)`,
          output: lines.join("\n") || "No symbols found.",
          metadata: { symbols: deduped },
        }
      }).pipe(Effect.orDie)

    return {
      description:
        "Extract a structural skeleton (functions, classes, interfaces) from a source file, or query symbols by name. " +
        "Use this to understand a file's architecture without reading every line.",
      parameters: Parameters,
      execute,
    }
  }),
)
