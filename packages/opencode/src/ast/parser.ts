// AST parser service — web-tree-sitter singleton, lazy grammar loading.
// web-tree-sitter is a pure-WASM dependency (no native compilation).

import { Effect, Layer, Context } from "effect"
import { LANGUAGE_MAP, type SupportedLanguage } from "./languages"

// Minimal structural types for web-tree-sitter (no @types package available).
interface TreeSitterNode {
  type: string
  text: string
  children: TreeSitterNode[]
  startPosition: { row: number; column: number }
  endPosition:   { row: number; column: number }
  startIndex: number
  endIndex:   number
}
interface TreeSitterTree   { rootNode: TreeSitterNode }
interface TreeSitterLanguage {
  query: (pattern: string) => { matches: (node: TreeSitterNode) => Array<{ captures: Array<{ node: TreeSitterNode }> }> }
}
interface TreeSitterParser {
  setLanguage: (lang: TreeSitterLanguage) => void
  parse:       (src: string) => TreeSitterTree
}
interface TreeSitterModule {
  init:     () => Promise<void>
  Parser:   new () => TreeSitterParser
  Language: { load: (path: string) => Promise<TreeSitterLanguage> }
}

let _initPromise: Promise<TreeSitterModule> | null = null
let _Parser: TreeSitterModule | null = null
const _grammarCache = new Map<string, TreeSitterLanguage>()

async function loadTreeSitter(): Promise<TreeSitterModule> {
  if (_Parser) return _Parser
  if (!_initPromise) {
    _initPromise = import("web-tree-sitter").then(async (mod) => {
      await (mod.default as TreeSitterModule).init()
      _Parser = mod.default as TreeSitterModule
      return _Parser
    })
  }
  return _initPromise
}

async function loadGrammar(language: SupportedLanguage): Promise<TreeSitterLanguage> {
  if (_grammarCache.has(language)) return _grammarCache.get(language)!
  const TS = await loadTreeSitter()
  const wasmPath = LANGUAGE_MAP[language]
  if (!wasmPath) throw new Error(`No grammar available for language: ${language}`)
  const grammar = await TS.Language.load(wasmPath)
  _grammarCache.set(language, grammar)
  return grammar
}

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

export interface ParseResult {
  tree:     TreeSitterTree
  language: SupportedLanguage
  rootNode: TreeSitterNode
}

export interface QueryMatch {
  node_type:    string
  name:         string | null
  start_line:   number
  end_line:     number
  start_col:    number
  end_col:      number
  start_byte:   number
  end_byte:     number
  text_preview: string
}

export interface Interface {
  parse:       (filePath: string, content: string) => Effect.Effect<ParseResult, Error>
  query:       (parseResult: ParseResult, pattern: string) => Effect.Effect<QueryMatch[], Error>
  queryFile:   (filePath: string, content: string, pattern: string, language?: SupportedLanguage) => Effect.Effect<QueryMatch[], Error>
  nodeAtRange: (parseResult: ParseResult, startLine: number, endLine: number) => Effect.Effect<QueryMatch | null>
}

const NAME_TYPES = new Set(["identifier", "type_identifier", "property_identifier", "name"])

function nodeToMatch(node: TreeSitterNode): QueryMatch {
  const nameNode = node.children.find((c) => NAME_TYPES.has(c.type))
  return {
    node_type:    node.type,
    name:         nameNode?.text ?? null,
    start_line:   node.startPosition.row,
    end_line:     node.endPosition.row,
    start_col:    node.startPosition.column,
    end_col:      node.endPosition.column,
    start_byte:   node.startIndex,
    end_byte:     node.endIndex,
    text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
  }
}

async function buildParseResult(content: string, language: SupportedLanguage): Promise<ParseResult> {
  const TS = await loadTreeSitter()
  const grammar = await loadGrammar(language)
  const parser = new TS.Parser()
  parser.setLanguage(grammar)
  const tree = parser.parse(content)
  return { tree, language, rootNode: tree.rootNode }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AstParser") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {

    const parse: Interface["parse"] = (filePath, content) =>
      Effect.tryPromise({
        try: () => {
          const language = detectLanguage(filePath)
          if (!language) throw new Error(`Unsupported file type: ${filePath}`)
          return buildParseResult(content, language)
        },
        catch: (e) => e as Error,
      })

    const query: Interface["query"] = (parseResult, pattern) =>
      Effect.tryPromise({
        try: async () => {
          const grammar = await loadGrammar(parseResult.language)
          return grammar
            .query(pattern)
            .matches(parseResult.rootNode)
            .flatMap((match) => match.captures.map((capture) => nodeToMatch(capture.node)))
        },
        catch: (e) => e as Error,
      })

    const queryFile: Interface["queryFile"] = (filePath, content, pattern, language) =>
      Effect.gen(function* () {
        const parsed = yield* language
          ? Effect.tryPromise({ try: () => buildParseResult(content, language), catch: (e) => e as Error })
          : parse(filePath, content)
        return yield* query(parsed, pattern)
      })

    const nodeAtRange: Interface["nodeAtRange"] = (parseResult, startLine, endLine) =>
      Effect.sync(() => {
        const walk = (node: TreeSitterNode): TreeSitterNode | null => {
          if (node.startPosition.row > startLine || node.endPosition.row < endLine) return null
          return node.children.reduce<TreeSitterNode | null>((found, child) => found ?? walk(child), null) ?? node
        }
        const node = walk(parseResult.rootNode)
        return node ? nodeToMatch(node) : null
      })

    return Service.of({ parse, query, queryFile, nodeAtRange })
  }),
)

/** Alias used by registry.ts — AstParser has no external dependencies so layer == defaultLayer. */
export const defaultLayer = layer

export { Service as AstParser }
