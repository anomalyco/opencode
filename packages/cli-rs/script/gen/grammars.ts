// Writes assets/queries/<filetype>/highlights.scm: the highlight queries the TypeScript TUI uses, so the linked
// grammars capture the same names. The TUI's 34 grammars take theirs from packages/tui/src/parsers-config.ts,
// downloaded and joined as Core's DownloadUtils.fetchHighlightQueries does. Core's own grammars (JavaScript,
// TypeScript, TSX, Markdown, Markdown inline, Zig) take the queries bundled in @opentui/core. Every query then gets
// Core's #lua-match? rewrite, so the files hold what Core compiles. The manifest lists
// each filetype with its aliases and sources; crates/ui/src/grammars checks its table against it.
import parsers from "../../../tui/src/parsers-config"

const root = new URL("../../assets/queries/", import.meta.url).pathname
const core = Bun.resolveSync("@opentui/core/package.json", import.meta.dir).replace(/package\.json$/, "")
// Core's query cache: getDataPaths().globalDataPath, then tree-sitter/queries.
const cache = `${process.env.XDG_DATA_HOME || `${process.env.HOME}/.local/share`}/opentui/tree-sitter/queries`
const bundled = ["javascript", "typescript", "typescriptreact", "markdown", "markdown_inline", "zig"]
const coreVersion = (await Bun.file(`${core}package.json`).json()).version

const tui = await Promise.all(
  parsers.parsers.map(async (parser) => ({
    filetype: parser.filetype,
    aliases: "aliases" in parser ? parser.aliases : [],
    sources: parser.queries.highlights,
    query: (await Promise.all(parser.queries.highlights.map((url) => load(url, parser.filetype))))
      .filter((query) => query.trim().length > 0)
      .join("\n"),
  })),
)
const own = await Promise.all(
  bundled.map(async (filetype) => ({
    filetype,
    aliases: filetype === "javascript" ? ["javascriptreact"] : [],
    sources: [`@opentui/core@${coreVersion}/assets/${filetype}/highlights.scm`],
    query: await Bun.file(`${core}assets/${filetype}/highlights.scm`).text(),
  })),
)
const entries = [...own, ...tui]
for (const entry of entries) await Bun.write(`${root}${entry.filetype}/highlights.scm`, translateLuaMatch(entry.query))
const manifest = entries.map((entry) => ({ filetype: entry.filetype, aliases: entry.aliases, sources: entry.sources }))
await Bun.write(`${root}manifest.json`, JSON.stringify(manifest, null, 2) + "\n")
console.log(`grammars: ${tui.length} TUI and ${own.length} Core highlight queries`)

// Core's cache first, as DownloadUtils.downloadOrLoad reads it: some sources follow a moving branch, and the cached
// copy is what TUI users highlight with (swift's `main` has moved past it).
async function load(url: string, filetype: string) {
  const cached = Bun.file(`${cache}/${filetype}-${hashUrl(url)}.scm`)
  if ((await cached.exists()) && cached.size > 0) return cached.text()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`grammars: ${url}: ${response.status} ${response.statusText}`)
  return response.text()
}

// Core's translateLuaMatch (parser.worker.ts), which it applies to every highlight query it loads: a #lua-match? whose
// Lua pattern uses only literals, anchors, simple sets, %d, ".", "*", and "+" becomes #match?, and any other stays and
// matches every node. Core writes "." as JavaScript's [^]; Rust's regex crate spells that (?s:.).
function translateLuaMatch(query: string) {
  return query.replace(
    /#(not-)?(any-)?lua-match\?(\s+@[\w.-]+\s+)"(\^?(?:(?:[\w/!:#.]|\[\^?(?:[\w*-]|%d)+\])[*+]?)*\$?)"/g,
    (predicate, not = "", any = "", capture: string, pattern: string) => {
      const digits = pattern.replaceAll("%d", "0-9")
      try {
        new RegExp(digits.replaceAll(".", "[^]"))
      } catch {
        return predicate
      }
      return `#${any}${not}match?${capture}"${digits.replaceAll(".", "(?s:.)")}"`
    },
  )
}

// DownloadUtils.hashUrl.
function hashUrl(url: string) {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0
  return Math.abs(hash).toString(16)
}
