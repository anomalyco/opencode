import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TreeSitterClient, type FiletypeParserOptions, type SimpleHighlight } from "@opentui/core"
import { bundledGrammars, type BundledGrammar } from "../script/bundled-grammars"
import { tmpdir } from "./fixture/fixture"

// Drives the real TreeSitterClient with real grammar wasm and .scm queries in
// the parser worker. The point is bump-safety: every language in the manifest
// gets compiled and highlighted, so a grammar or query version bump that
// breaks loading fails here instead of in a shipped binary.
//
// Grammar assets are never committed to git. They come from the first
// available source: OPENTUI_BUNDLED_GRAMMARS_DIR (Nix), the gitignored
// gen/grammars build output, or a gitignored cache fetched from the pinned
// manifest URLs and verified by sha256. Cached files are re-fetched only when
// their sha256 stops matching; the parity test also checks the no-fetch path
// in the worker logs.

const workerPath = fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))
const grammarCacheDir = path.join(import.meta.dirname, "..", ".cache", "grammars")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

const grammarSpecs = [
  ...new Map(
    Object.values(bundledGrammars)
      .flatMap((grammar) => [grammar.wasm, ...Object.values(grammar.queries).flat()])
      .map((spec) => [spec.url, spec] as const),
  ).values(),
]

async function populateGrammarCache() {
  await mkdir(grammarCacheDir, { recursive: true })
  for (const spec of grammarSpecs) {
    const target = path.join(grammarCacheDir, spec.file)
    if (existsSync(target) && sha256(await readFile(target)) === spec.sha256) continue
    const res = await fetch(spec.url)
    if (!res.ok) throw new Error(`Failed to fetch grammar asset ${spec.url}: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(sha256(bytes), `${spec.file} did not match its pinned sha256`).toBe(spec.sha256)
    await writeFile(target, bytes)
  }
}

async function resolveGrammarDir(): Promise<string> {
  const envDir = process.env.OPENTUI_BUNDLED_GRAMMARS_DIR
  if (envDir) return envDir
  const genDir = path.join(import.meta.dirname, "..", "gen", "grammars")
  if (existsSync(genDir)) return genDir
  await populateGrammarCache()
  return grammarCacheDir
}

let grammarDirPromise: Promise<string> | undefined
function getGrammarDir(): Promise<string> {
  return (grammarDirPromise ??= resolveGrammarDir())
}

// One real snippet per manifest filetype. Small but valid, with at least one
// construct the standard highlights query captures (comment, string, or the
// language's main node), so a query that stopped matching anything fails the
// non-empty assertion below.
const sources: Record<string, string> = {
  agda: 'module Foo where\n\nfoo : Set\nfoo = "hello" -- comment\n',
  bash: '# comment\nx="hello"\necho "$x"\n',
  c: '// comment\nint main() {\n  char *s = "hello";\n  return 0;\n}\n',
  clojure: ';; comment\n(def x "hello")\n',
  cpp: '// comment\nint main() {\n  std::string s = "hello";\n}\n',
  csharp: 'class Foo {\n    // comment\n    string s = "hi";\n}\n',
  css: "/* comment */\nbody { color: red; }\n",
  diff: "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n",
  elixir: '# comment\n def foo, do: "hello"\n',
  fsharp: '// comment\nlet s = "hello"\n',
  go: '// comment\nfunc main() {\n\ts := "hello"\n\t_ = s\n}\n',
  haskell: '-- comment\nmain = putStrLn "hello"\n',
  hcl: '# comment\nresource "a" "b" {\n  x = 1\n}\n',
  html: "<!DOCTYPE html>\n<html><body><!-- comment --><p>hello</p></body></html>\n",
  java: '// comment\nclass Foo {\n  String s = "hello";\n}\n',
  json: '{ "key": "value", "n": 1 }\n',
  julia: '# comment\ns = "hello"\nprintln(s)\n',
  kotlin: '// comment\nfun main() {\n    val s = "hello"\n}\n',
  lua: '-- comment\nlocal s = "hello"\n',
  make: '# comment\nall:\n\techo "hello"\n',
  nix: '# comment\n{ x = "hello"; }\n',
  ocaml: '(* comment *)\nlet s = "hello"\n',
  php: '<?php\n// comment\n$x = "hello";\n',
  python: "def foo():\n    # comment\n    return 'hello'\n",
  r: '# comment\ns <- "hello"\n',
  ruby: '# comment\ns = "hello"\nputs s\n',
  rust: 'fn main() {\n    // comment\n    let s = "hi";\n}\n',
  scala: '// comment\nobject Foo { def main(): Unit = println("hello") }\n',
  swift: '// comment\nlet s = "hello"\n',
  toml: '# comment\nkey = "value"\n',
  vim: '" comment\nlet s = "hello"\n',
  vue: '<template>\n  <div class="x">hi</div>\n</template>\n',
  xml: '<?xml version="1.0"?>\n<!-- comment --><root>hello</root>\n',
  yaml: "# comment\nkey: value\n",
}

// Capture names pinned for the filetypes whose query semantics this suite has
// hand-verified; the rest rely on the non-empty highlights assertion.
const expectedGroups: Record<string, string[]> = {
  python: ["keyword", "comment", "string"],
  rust: ["keyword.function", "comment", "string"],
  vue: ["tag", "tag.attribute", "string"],
  csharp: ["keyword.type", "comment", "string"],
}

function localParser(filetype: string, grammarDir: string): FiletypeParserOptions {
  const grammar = bundledGrammars[filetype]
  return {
    filetype,
    wasm: path.join(grammarDir, grammar.wasm.file),
    queries: { highlights: grammar.queries.highlights.map((asset) => path.join(grammarDir, asset.file)) },
  }
}

function urlParser(filetype: string, grammar: BundledGrammar): FiletypeParserOptions {
  return {
    filetype,
    wasm: grammar.wasm.url,
    queries: { highlights: grammar.queries.highlights.map((asset) => asset.url) },
  }
}

// Mirrors DownloadUtils.hashUrl in @opentui/core's parser worker. Seeding the
// cache under these names lets the URL-mode config avoid any fetch; the parity
// test's worker-log assertions fail loudly if the cache layout drifts.
function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

// The worker caches wasm at <dataPath>/tree-sitter/languages/<basename> and
// queries at <dataPath>/tree-sitter/queries/<filetype>-<hash>.scm. Seeding
// those paths makes the pinned dev-mode URLs load from the cache, through the
// same code path the worker uses at runtime.
async function seedUrlCache(grammarDir: string, dataPath: string, filetype: string, grammar: BundledGrammar) {
  const languagesDir = path.join(dataPath, "tree-sitter", "languages")
  const queriesDir = path.join(dataPath, "tree-sitter", "queries")
  await mkdir(languagesDir, { recursive: true })
  await mkdir(queriesDir, { recursive: true })
  await writeFile(
    path.join(languagesDir, path.basename(grammar.wasm.url)),
    await readFile(path.join(grammarDir, grammar.wasm.file)),
  )
  for (const assets of Object.values(grammar.queries)) {
    for (const asset of assets) {
      await writeFile(
        path.join(queriesDir, `${filetype}-${hashUrl(asset.url)}.scm`),
        await readFile(path.join(grammarDir, asset.file)),
      )
    }
  }
}

async function boot(dataPath: string, parser?: FiletypeParserOptions) {
  const client = new TreeSitterClient({ dataPath, workerPath })
  try {
    await client.initialize()
    if (parser) client.addFiletypeParser(parser)
    return client
  } catch (error) {
    await client.destroy()
    throw error
  }
}

async function highlightOnce(
  parser: FiletypeParserOptions,
  source: string,
  opts?: { seed?: (dataPath: string) => Promise<void>; logs?: string[] },
): Promise<SimpleHighlight[]> {
  await using tmp = await tmpdir()
  if (opts?.seed) await opts.seed(tmp.path)
  const client = await boot(tmp.path, parser)
  if (opts?.logs) {
    const logs = opts.logs
    client.on("worker:log", (_logType, message) => logs.push(message))
  }
  try {
    const result = await client.highlightOnce(source, parser.filetype)
    expect(result.error, `${parser.filetype} highlighting error`).toBeUndefined()
    return result.highlights ?? []
  } finally {
    await client.destroy()
  }
}

function assertInBounds(highlights: SimpleHighlight[], content: string) {
  const length = Buffer.byteLength(content)
  for (const [start, end, group] of highlights) {
    expect(group).toBeTypeOf("string")
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(end).toBeLessThanOrEqual(length)
  }
}

const asTuple = ([start, end, group]: SimpleHighlight) => [start, end, group] as const

describe("bundled tree-sitter grammars", () => {
  test("resolved grammar assets byte-match the pinned manifest", async () => {
    const grammarDir = await getGrammarDir()
    for (const grammar of Object.values(bundledGrammars)) {
      const assets = [grammar.wasm, ...Object.values(grammar.queries).flat()]
      for (const asset of assets) {
        expect(sha256(await readFile(path.join(grammarDir, asset.file))), `${asset.file} drifted from manifest`).toBe(
          asset.sha256,
        )
      }
    }
  })

  // One client and worker for the whole sweep: a grammar compile costs about
  // the same wherever it runs, so sharing the client keeps 34 filetypes around
  // two seconds instead of one worker boot per test.
  let sweepClient: TreeSitterClient
  let sweepDataPath: Awaited<ReturnType<typeof tmpdir>>

  beforeAll(async () => {
    const grammarDir = await getGrammarDir()
    sweepDataPath = await tmpdir()
    sweepClient = await boot(sweepDataPath.path)
    for (const filetype of Object.keys(bundledGrammars)) {
      sweepClient.addFiletypeParser(localParser(filetype, grammarDir))
    }
  })

  afterAll(async () => {
    await sweepClient?.destroy()
    await sweepDataPath?.[Symbol.asyncDispose]()
  })

  for (const filetype of Object.keys(bundledGrammars)) {
    test(`${filetype} compiles and highlights a real snippet`, async () => {
      expect(await sweepClient.preloadParser(filetype), `${filetype} parser failed to compile`).toBe(true)
      const source = sources[filetype]
      expect(source, `no test snippet defined for ${filetype}`).toBeTypeOf("string")
      const result = await sweepClient.highlightOnce(source, filetype)
      expect(result.error, `${filetype} highlighting error`).toBeUndefined()
      expect(result.highlights?.length, `${filetype} produced no highlights`).toBeGreaterThan(0)
      assertInBounds(result.highlights!, source)
      const groups = new Set(result.highlights!.map((h) => h[2]))
      for (const group of expectedGroups[filetype] ?? []) {
        expect(groups.has(group), `${filetype} missing expected capture ${group}`).toBe(true)
      }
    })
  }

  test("bundled paths produce identical highlights to the pinned dev-mode URLs", async () => {
    const grammarDir = await getGrammarDir()
    for (const filetype of ["python", "vue", "csharp"]) {
      const grammar = bundledGrammars[filetype]
      const source = sources[filetype]
      const fromPaths = await highlightOnce(localParser(filetype, grammarDir), source)
      const logs: string[] = []
      const fromUrls = await highlightOnce(urlParser(filetype, grammar), source, {
        seed: (dataPath) => seedUrlCache(grammarDir, dataPath, filetype, grammar),
        logs,
      })
      expect(fromUrls.map(asTuple), `${filetype} bundled/dev highlight mismatch`).toEqual(fromPaths.map(asTuple))
      // The worker logs a cache hit per seeded asset and a download on any miss.
      expect(
        logs.some((log) => log.includes("Downloading from URL")),
        `${filetype} worker fetched a pinned URL instead of using the seeded cache`,
      ).toBe(false)
      expect(
        logs.some((log) => log.includes("Loaded from cache")),
        `${filetype} worker never loaded a seeded cache file`,
      ).toBe(true)
    }
  })
})
