// local-only: Lädt alle Tree-sitter-Grammatiken und Queries aus src/parsers-config.ts EINMALIG herunter und legt sie
// unter assets/tree-sitter/ ab. Zur Laufzeit lädt die TUI danach nichts mehr aus dem Internet.
//
// Welche Sprachen mitgeliefert werden, steht in script/parsers-languages.json.
//
// Ausführen (Entwicklungszeit, braucht Netz):   node packages/tui/script/vendor-parsers.mjs
//                                         oder:  bun packages/tui/script/vendor-parsers.mjs
//
// Erzeugt:
//   assets/tree-sitter/<filetype>/...      die heruntergeladenen .wasm/.scm-Dateien
//   assets/tree-sitter/manifest.json       Parser-Liste mit relativen Pfaden (Node-Build, Tests)
//   src/parsers-local.bun.ts               statische `with { type: "file" }`-Imports (Bun bettet sie ins Binary ein)
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const assets = path.join(root, "assets", "tree-sitter")
const config = (await import(pathToFileURL(path.join(root, "src", "parsers-config.ts")).href)).default
// Nur die Sprachen aus script/parsers-languages.json mitliefern; seltene Sprachen bleiben ohne Highlighting.
const { languages } = JSON.parse(await readFile(path.join(root, "script", "parsers-languages.json"), "utf8"))
const unknown = languages.filter((language) => !config.parsers.some((parser) => parser.filetype === language))
if (unknown.length) throw new Error(`Nicht in parsers-config.ts: ${unknown.join(", ")}`)
const selected = config.parsers.filter((parser) => languages.includes(parser.filetype))

const isUrl = (value) => typeof value === "string" && /^https?:\/\//.test(value)
const safe = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_")

async function download(url, target) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error(`leere Antwort: ${url}`)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
  return bytes
}

await rm(assets, { recursive: true, force: true })

const manifest = []
const sources = []
for (const parser of selected) {
  const dir = safe(parser.filetype)
  const local = { ...parser, queries: {} }
  if (!isUrl(parser.wasm)) throw new Error(`${parser.filetype}: wasm ist keine URL: ${parser.wasm}`)
  local.wasm = `${dir}/${safe(path.posix.basename(new URL(parser.wasm).pathname))}`
  sources.push({ url: parser.wasm, rel: local.wasm })

  for (const [kind, urls] of Object.entries(parser.queries ?? {})) {
    local.queries[kind] = urls.map((url, index) => {
      if (!isUrl(url)) throw new Error(`${parser.filetype}: Query ist keine URL: ${url}`)
      const rel = `${dir}/${kind}-${index}-${safe(path.posix.basename(new URL(url).pathname))}`
      sources.push({ url, rel })
      return rel
    })
  }
  manifest.push(local)
}

let failed = 0
const hashes = {}
await Promise.all(
  sources.map(async ({ url, rel }) => {
    try {
      const bytes = await download(url, path.join(assets, rel))
      hashes[rel] = { url, sha256: createHash("sha256").update(bytes).digest("hex") }
    } catch (error) {
      failed++
      console.error(`FEHLER ${rel}: ${error.message}`)
    }
  }),
)
if (failed) {
  console.error(`${failed} von ${sources.length} Dateien fehlgeschlagen – nichts weiter geschrieben.`)
  process.exit(1)
}

await writeFile(path.join(assets, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
await writeFile(
  path.join(assets, "sources.json"),
  JSON.stringify(Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n",
)

// Bun-Variante: jede Datei statisch importieren, damit `bun build --compile` sie einbettet.
const names = new Map(sources.map(({ rel }, index) => [rel, `asset${index}`]))
const lines = [
  "// local-only: GENERIERT von script/vendor-parsers.mjs – nicht von Hand ändern.",
  "// Lokale Tree-sitter-Grammatiken; ersetzt die Internet-URLs aus parsers-config.ts.",
  '/// <reference path="./tree-sitter-assets.d.ts" />',
  ...sources.map(
    ({ rel }) => `import ${names.get(rel)} from "../assets/tree-sitter/${rel}" with { type: "file" }`,
  ),
  "",
  "export const parsers = [",
  ...manifest.map((parser) => {
    const queries = Object.entries(parser.queries)
      .map(([kind, rels]) => `${kind}: [${rels.map((rel) => names.get(rel)).join(", ")}]`)
      .join(", ")
    const { wasm: _wasm, queries: _queries, ...rest } = parser
    const extra = Object.entries(rest).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    return `  { ${[...extra, `wasm: ${names.get(parser.wasm)}`, `queries: { ${queries} }`].join(", ")} },`
  }),
  "]",
  "",
]
await writeFile(path.join(root, "src", "parsers-local.bun.ts"), lines.join("\n"))

console.log(`${sources.length} Dateien für ${manifest.length} Parser nach ${path.relative(process.cwd(), assets)} geladen.`)
