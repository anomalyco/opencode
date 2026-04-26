// AST parser service — web-tree-sitter singleton, lazy grammar loading.
// web-tree-sitter is a pure-WASM dependency (no native compilation).

import { Effect, Layer, Context } from "effect"
import { LANGUAGE_MAP, type SupportedLanguage } from "./languages"

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

// Single init-promise so concurrent callers share the same initialisation.
let _initPromise: Promise<any> | null = null
let _Parser: any = null

const _grammarCache = new Map<string, any>()

async function loadTreeSitter(): Promise<any> {
  if (_Parser) return _Parser
  if (!_initPromise) {
    _initPromise = (async () => {
      const mod = await import("web-tree-sitter")
      await mod.default.init()
      _Parser = mod.default
      return _Parser
    })()
  }
  return _initPromise
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

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_MAP: Record<string, SupportedLanguage> = {
  ts:   "typescript",
  tsx:  "tsx",
  js:   "javascript",
  jsx:  "javascript",
  mjs:  "javascript",
  cjs:  "javascript",
  py:   "python",
  sh:   "bash",
  bash: "bash",
  go:   "go",
  rs:   "rust",
  rb:   "ruby",
  java: "java",
  c:    "c",
  h:    "c",
  cc:   "cpp",
  cpp:  "cpp",
  cxx:  "cpp",
  hh:   "cpp",
  hpp:  "cpp",
  css:  "css",
  html: "html",
  htm:  "html",
  json: "json",
  yml:  "yaml",
  yaml: "yaml",
  toml: "toml",
}

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MAP[ext] ?? null
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  parse:       (filePath: string, content: string) => Effect.Effect<ParseResult, Error>
  query:       (parseResult: ParseResult, pattern: string) => Effect.Effect<QueryMatch[], Error>
  queryFile:   (filePath: string, content: string, pattern: string, language?: SupportedLanguage) => Effect.Effect<QueryMatch[], Error>
  nodeAtRange: (parseResult: ParseResult, startLine: number, endLine: number) => Effect.Effect<QueryMatch | null>
}

// ---------------------------------------------------------------------------
// Effect Service
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@opencode/AstParser") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {

    const parse: Interface["parse"] = (filePath, content) =>
      Effect.tryPromise({
        try: async () => {
          const language = detectLanguage(filePath)
          if (!language) throw new Error(`Unsupported file type: ${filePath}`)
          const TS = await loadTreeSitter()
          const grammar = await loadGrammar(language)
          // Create a new Parser instance per call — Parser instances are not thread-safe
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
              let name: string | null = null
              for (const child of node.children) {
                if (
                  child.type === "identifier" ||
                  child.type === "type_identifier" ||
                  child.type === "property_identifier" ||
                  child.type === "name"
                ) {
                  name = child.text
                  break
                }
              }
              results.push({
                node_type:    node.type,
                name,
                start_line:   node.startPosition.row,
                end_line:     node.endPosition.row,
                start_col:    node.startPosition.column,
                end_col:      node.endPosition.column,
                start_byte:   node.startIndex,
                end_byte:     node.endIndex,
                text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
              })
            }
          }
          return results
        },
        catch: (e) => e as Error,
      })

    const queryFile: Interface["queryFile"] = (filePath, content, pattern, language) =>
      Effect.gen(function* () {
        // Allow explicit language override (e.g. .ts file queried as tsx)
        const parsed = yield* language
          ? Effect.tryPromise({
              try: async () => {
                const TS = await loadTreeSitter()
                const grammar = await loadGrammar(language)
                const parser = new TS.Parser()
                parser.setLanguage(grammar)
                const tree = parser.parse(content)
                return { tree, language, rootNode: tree.rootNode } as ParseResult
              },
              catch: (e) => e as Error,
            })
          : parse(filePath, content)
        return yield* query(parsed, pattern)
      })

    const nodeAtRange: Interface["nodeAtRange"] = (parseResult, startLine, endLine) =>
      Effect.sync(() => {
        // Walk looking for the *tightest* node that fully contains the requested range.
        // Exact match is preferred; containment is accepted as fallback.
        function walk(node: any): any | null {
          const nStart = node.startPosition.row
          const nEnd   = node.endPosition.row
          // Must contain the requested range
          if (nStart > startLine || nEnd < endLine) return null
          // Try to find a tighter match among children
          for (const child of node.children) {
            const found = walk(child)
            if (found) return found
          }
          // This node is the tightest containing node
          return node
        }
        const node = walk(parseResult.rootNode)
        if (!node) return null
        return {
          node_type:    node.type,
          name:         null,
          start_line:   node.startPosition.row,
          end_line:     node.endPosition.row,
          start_col:    node.startPosition.column,
          end_col:      node.endPosition.column,
          start_byte:   node.startIndex,
          end_byte:     node.endIndex,
          text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
        } as QueryMatch
      })

    return Service.of({ parse, query, queryFile, nodeAtRange })
  }),
)

export const defaultLayer = layer

export { Service as AstParser }
