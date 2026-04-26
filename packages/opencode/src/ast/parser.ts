// AST parser service — web-tree-sitter singleton, lazy grammar loading.
// web-tree-sitter is a pure-WASM dependency (no native compilation).

import * as path from "path"
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
interface TreeSitterLanguage {
  query: (pattern: string) => TreeSitterQuery
}
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
    start_byte:   node.startIndex,
    end_byte:     node.endIndex,
    text_preview: node.text.slice(0, 120).replace(/\n/g, "↵"),
  }
}

async function buildParseResult(content: string, language: SupportedLanguage): Promise<ParseResult> {
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
          if (!language) throw new Error(`[ast] Unsupported file type: ${filePath}`)
          return buildParseResult(content, language)
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })

    const query: Interface["query"] = (parseResult, pattern, lastCaptureOnly) =>
      Effect.tryPromise({
        try: async () => {
          const grammar = await loadGrammar(parseResult.language)
          const q = grammar.query(pattern)
          const captureNames = q.captureNames
          return q
            .matches(parseResult.rootNode)
            .flatMap((match) => {
              if (lastCaptureOnly) {
                // Find the capture whose name has the highest index in captureNames.
                // This corresponds to the last capture defined in the query pattern.
                const best = match.captures.reduce<
                  { idx: number; capture: typeof match.captures[number] | null }
                >((acc, c) => {
                  const idx = captureNames.indexOf(c.name)
                  return idx > acc.idx ? { idx, capture: c } : acc
                }, { idx: -1, capture: null })
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
