// AST parser service — web-tree-sitter singleton, lazy grammar loading
// web-tree-sitter is already a project dependency (WASM, no native compile)

import { Effect, Layer, Context } from "effect"
import { Log } from "@/util"
import { LANGUAGE_MAP, type SupportedLanguage } from "./languages"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const log = Log.create({ service: "ast.parser" })

// Dynamically imported to avoid loading the WASM at startup
let _Parser: any = null
const _grammarCache = new Map<string, any>()

async function loadTreeSitter() {
  if (_Parser) return _Parser
  const TreeSitter = await import("web-tree-sitter")
  await TreeSitter.default.init()
  _Parser = TreeSitter.default
  return _Parser
}

async function loadGrammar(language: SupportedLanguage): Promise<any> {
  if (_grammarCache.has(language)) return _grammarCache.get(language)!
  const TS = await loadTreeSitter()
  const wasmPath = LANGUAGE_MAP[language]
  if (!wasmPath) throw new Error(`No grammar available for language: ${language}`)
  const grammar = await TS.Language.load(wasmPath)
  _grammarCache.set(language, grammar)
  return grammar
}

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, SupportedLanguage> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    sh: "bash",
    bash: "bash",
  }
  return map[ext] ?? null
}

export interface ParseResult {
  tree: any
  language: SupportedLanguage
  rootNode: any
}

export interface QueryMatch {
  node_type: string
  name: string | null
  start_line: number
  end_line: number
  start_col: number
  end_col: number
  start_byte: number
  end_byte: number
  text_preview: string
}

export interface Interface {
  parse: (filePath: string, content: string) => Effect.Effect<ParseResult, Error>
  query: (parseResult: ParseResult, pattern: string) => Effect.Effect<QueryMatch[], Error>
  queryFile: (filePath: string, content: string, pattern: string) => Effect.Effect<QueryMatch[], Error>
  nodeAtRange: (parseResult: ParseResult, startLine: number, endLine: number) => Effect.Effect<QueryMatch | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AstParser") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const parse: Interface["parse"] = (filePath, content) =>
      Effect.tryPromise({
        try: async () => {
          const language = detectLanguage(filePath)
          if (!language) throw new Error(`Unsupported file type: ${filePath}`)
          const TS = await loadTreeSitter()
          const grammar = await loadGrammar(language)
          const parser = new TS.Parser()
          parser.setLanguage(grammar)
          const tree = parser.parse(content)
          return { tree, language, rootNode: tree.rootNode } as ParseResult
        },
        catch: (e) => e as Error,
      })

    const query: Interface["query"] = (parseResult, pattern) =>
      Effect.tryPromise({
        try: async () => {
          const grammar = await loadGrammar(parseResult.language)
          const q = grammar.query(pattern)
          const matches = q.matches(parseResult.rootNode)
          const results: QueryMatch[] = []
          for (const match of matches) {
            for (const capture of match.captures) {
              const node = capture.node
              // Extract identifier name from first named child if present
              let name: string | null = null
              for (const child of node.children) {
                if (child.type === "identifier" || child.type === "type_identifier" || child.type === "property_identifier") {
                  name = child.text
                  break
                }
              }
              const preview = node.text.slice(0, 120).replace(/\n/g, "↵")
              results.push({
                node_type: node.type,
                name,
                start_line: node.startPosition.row,
                end_line: node.endPosition.row,
                start_col: node.startPosition.column,
                end_col: node.endPosition.column,
                start_byte: node.startIndex,
                end_byte: node.endIndex,
                text_preview: preview,
              })
            }
          }
          return results
        },
        catch: (e) => e as Error,
      })

    const queryFile: Interface["queryFile"] = (filePath, content, pattern) =>
      Effect.gen(function* () {
        const parsed = yield* parse(filePath, content)
        return yield* query(parsed, pattern)
      })

    const nodeAtRange: Interface["nodeAtRange"] = (parseResult, startLine, endLine) =>
      Effect.sync(() => {
        function walk(node: any): any | null {
          if (node.startPosition.row === startLine && node.endPosition.row === endLine) return node
          for (const child of node.children) {
            const found = walk(child)
            if (found) return found
          }
          return null
        }
        const node = walk(parseResult.rootNode)
        if (!node) return null
        return {
          node_type: node.type,
          name: null,
          start_line: node.startPosition.row,
          end_line: node.endPosition.row,
          start_col: node.startPosition.column,
          end_col: node.endPosition.column,
          start_byte: node.startIndex,
          end_byte: node.endIndex,
          text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
        } as QueryMatch
      })

    return Service.of({ parse, query, queryFile, nodeAtRange })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
