// AST parser service — web-tree-sitter singleton, lazy grammar loading.
// web-tree-sitter is a pure-WASM dependency (no native compilation).

import * as path from "path"
import * as crypto from "crypto"
import { Effect, Layer, Context } from "effect"
import { LANGUAGE_MAP, type SupportedLanguage } from "./languages"

// Minimal structural types for web-tree-sitter (no @types package available).
// Using interfaces instead of `any` to satisfy the no-any rule.
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
interface TreeSitterLanguage {}
interface TreeSitterQuery {
  readonly captureNames: string[]
  matches: (node: TreeSitterNode) => Array<{
    readonly captures: Array<{ readonly name: string; readonly node: TreeSitterNode }>
    readonly pattern: number
  }>
}
interface TreeSitterParser {
  setLanguage: (lang: TreeSitterLanguage) => void
  parse:       (src: string) => TreeSitterTree
}
interface TreeSitterModule {
  init:     () => Promise<void>
  Parser:   new () => TreeSitterParser
  Language: { load: (path: string) => Promise<TreeSitterLanguage> }
  Query:    new (language: TreeSitterLanguage, source: string) => TreeSitterQuery
}
// web-tree-sitter 0.25+ exports named classes: Parser (with static init) and
// Language (with static load). We keep a minimal promise gate for init().
let _initPromise: Promise<void> | null = null

async function ensureInit(): Promise<void> {
  if (!_initPromise) {
    const { Parser } = await import("web-tree-sitter")
    _initPromise = Parser.init()
  }
  return _initPromise
}

const _grammarCache = new Map<string, TreeSitterLanguage>()
const _parserCache = new Map<SupportedLanguage, TreeSitterParser>()

class LRUCache<K, V> {
  private cache = new Map<K, V>()
  constructor(private maxSize: number) {}
  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }
}

const _treeCache = new LRUCache<string, ParseResult>(50)

async function loadGrammar(language: SupportedLanguage): Promise<TreeSitterLanguage> {
  if (_grammarCache.has(language)) return _grammarCache.get(language)!
  await ensureInit()
  const { Language } = await import("web-tree-sitter")
  const wasmPath = LANGUAGE_MAP[language]
  if (!wasmPath) throw new Error(`[ast] No grammar available for language: ${language}`)
  const grammar = await Language.load(wasmPath) as unknown as TreeSitterLanguage
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
  const ext = path.extname(filePath).toLowerCase()
  return EXT_MAP[ext.slice(1)] ?? null
}

export interface ParseResult {
  tree:         TreeSitterTree
  language:     SupportedLanguage
  rootNode:     TreeSitterNode
  language_obj: TreeSitterLanguage
}

export interface QueryMatch {
  node_type:    string
  name:         string | null
  start_line:   number
  end_line:     number
  start_col:    number
  end_col:      number
  start_index:  number // UTF-16 character offset — use for string.slice()
  end_index:    number // UTF-16 character offset — use for string.slice()
  text_preview: string
}

export interface Interface {
  parse:       (filePath: string, content: string) => Effect.Effect<ParseResult, Error>
  query:       (parseResult: ParseResult, pattern: string, lastCaptureOnly?: boolean) => Effect.Effect<QueryMatch[], Error>
  queryFile:   (filePath: string, content: string, pattern: string, language?: SupportedLanguage, lastCaptureOnly?: boolean) => Effect.Effect<QueryMatch[], Error>
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
    start_index:  node.startIndex,
    end_index:    node.endIndex,
    text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
  }
}

async function buildParseResult(content: string, language: SupportedLanguage): Promise<ParseResult> {
  const hash = crypto.createHash("sha256").update(content).digest("hex")
  const key = `${language}:${hash}`
  const cached = _treeCache.get(key)
  if (cached) return cached

  await ensureInit()
  const { Parser } = await import("web-tree-sitter")
  const grammar = await loadGrammar(language)
  const parser = _parserCache.get(language) ?? (() => {
    const p = new Parser() as unknown as TreeSitterParser
    p.setLanguage(grammar)
    _parserCache.set(language, p)
    return p
  })()
  const tree = parser.parse(content)
  const result: ParseResult = { tree, language, rootNode: tree.rootNode, language_obj: grammar }
  _treeCache.set(key, result)
  return result
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AstParser") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {

    const parse: Interface["parse"] = (filePath, content) =>
      Effect.tryPromise({
        try: () => {
          const language = detectLanguage(filePath)
          if (!language) throw new Error(`[ast] Unsupported file type: ${filePath}`)
          return buildParseResult(content, language)
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })

    const query: Interface["query"] = (parseResult, pattern, lastCaptureOnly) =>
      Effect.tryPromise({
        try: async () => {
          const { Query } = await import("web-tree-sitter") as unknown as TreeSitterModule
          const q = new Query(parseResult.language_obj, pattern)
          return q
            .matches(parseResult.rootNode)
            .flatMap((match) => {
              if (lastCaptureOnly) {
                // Pick the capture whose node has the largest span.
                // This is always the outermost node the user wants to replace.
                const best = match.captures.reduce<
                  { span: number; capture: typeof match.captures[number] | null }
                >((acc, c) => {
                  const span = c.node.endIndex - c.node.startIndex
                  return span > acc.span ? { span, capture: c } : acc
                }, { span: -1, capture: null })
                return best.capture ? [nodeToMatch(best.capture.node)] : []
              }
              return match.captures.map((capture) => nodeToMatch(capture.node))
            })
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })

    const queryFile: Interface["queryFile"] = (filePath, content, pattern, language, lastCaptureOnly) =>
      Effect.gen(function* () {
        const parsed = yield* language
          ? Effect.tryPromise({ try: () => buildParseResult(content, language), catch: (e) => (e instanceof Error ? e : new Error(String(e))) })
          : parse(filePath, content)
        return yield* query(parsed, pattern, lastCaptureOnly)
      })

    const nodeAtRange: Interface["nodeAtRange"] = (parseResult, startLine, endLine) =>
      Effect.sync(() => {
        // Find the tightest node fully containing [startLine, endLine].
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

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => layer)

export * as AstParser from "./parser"
