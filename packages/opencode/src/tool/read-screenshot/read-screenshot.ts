import { Effect } from "effect"
import path from "path"
import { fileURLToPath } from "url"

// Renders read tool output as syntax-highlighted PNG "screenshots" so vision
// models consume code as pixels instead of text. Pages are sized to pass every
// provider's vision pipeline untouched. Anthropic standard-resolution models
// are the strictest: an image is downscaled once it exceeds 1568px on the long
// edge or ceil(w/28) * ceil(h/28) > 1568 visual tokens (one token per 28px
// patch). Inside both limits the model sees the exact pixels rendered here,
// and OpenAI's resize pipeline also leaves these dimensions alone.
//
// Cost per rendered row is ceil(width/28) * (LINE_HEIGHT/28) visual tokens, so
// every page is kept as narrow as its content allows: ~6.1 tokens per line at
// the full 120 columns, ~4.3 at 80, ~3.3 at 60. The same lines as text
// typically cost 10-25 tokens each including the line-number prefix.
// script/read-screenshot-cost.ts measures the delta on real files.

const FONT_SIZE = 7
const LINE_HEIGHT = 8.5
// JetBrains Mono's advance width is exactly 0.6em, so columns map 1:1 to pixels.
const CHAR_WIDTH = FONT_SIZE * 0.6
const TAB = " ".repeat(4)
const PADDING = 8
const HEADER_HEIGHT = 16
const PATCH = 28
const PAGE_TOKENS = 1568
const PAGE_EDGE = 1568
const THEME = "github-light"
// The NL (no ligatures) variant keeps glyphs and characters 1:1, so what the
// model reads maps byte-exactly onto the file — `===` never becomes `≡`.
const FONT_FAMILY = "JetBrains Mono NL"
// Continuation rows of a wrapped source line carry this dim gutter marker
// instead of a line number, so numbering always tracks file lines.
const WRAP_MARKER = "↪"

export const COLUMNS = 120
const MIN_COLUMNS = 60
// Below this many lines the fixed payload (note text + page chrome) outweighs
// the pixel savings — measured on this repo with script/read-screenshot-cost.ts,
// reads under 15 lines are cheaper as plain text.
export const MIN_LINES = 15

export interface Token {
  content: string
  color?: string
  fontStyle?: number
}

export interface Row {
  line?: number
  tokens: Token[]
}

export interface Page {
  start: number
  end: number
  rows: Row[]
}

export interface Rendered {
  url: string
  start: number
  end: number
}

export interface Input {
  /** workspace-relative path shown in every page header */
  path: string
  /** absolute path, used for language detection */
  filepath: string
  lines: string[]
  offset: number
  /** total lines in the file; omit when unknown (read stopped at the byte cap) */
  total?: number
}

// PoC gate: only the models whose visual reasoning this experiment targets.
// No per-model tuning yet — both get identical pages.
export function supports(modelID: string) {
  const id = modelID.toLowerCase()
  return id.includes("gpt-5.5") || id.includes("fable")
}

export function language(filepath: string) {
  const base = path.basename(filepath).toLowerCase()
  if (base === "dockerfile") return "docker"
  return LANGUAGES[path.extname(base).slice(1)]
}

// Per-line pixel cost scales with page width, so every page is only as wide
// as its own widest row. Wrapping stays fixed at COLUMNS so identical lines
// render identically on every page.
export function pageColumns(page: Page) {
  const widest = page.rows.reduce(
    (max, row) => Math.max(max, row.tokens.reduce((n, token) => n + token.content.length, 0)),
    0,
  )
  return Math.min(COLUMNS, Math.max(MIN_COLUMNS, widest))
}

export function dimensions(maxLine: number, cols: number = COLUMNS) {
  const digits = Math.max(3, String(Math.max(1, maxLine)).length)
  const gutter = Math.ceil(digits * CHAR_WIDTH) + 8
  const width = Math.ceil(PADDING * 2 + gutter + cols * CHAR_WIDTH)
  const height = Math.min(PAGE_EDGE, Math.floor(PAGE_TOKENS / Math.ceil(width / PATCH)) * PATCH)
  const rows = Math.floor((height - PADDING * 2 - HEADER_HEIGHT) / LINE_HEIGHT)
  return { width, gutter, height, rows, cols }
}

// Pages break at source-line boundaries so every page starts with a numbered
// row. Safe because read caps lines at 2000 chars (≤ 34 wrapped rows), far
// below a page's row capacity.
export function paginate(lines: Token[][], offset: number, cols: number = COLUMNS): Page[] {
  const capacity = dimensions(offset + lines.length - 1, cols).rows
  return lines
    .reduce<Row[][]>((pages, tokens, index) => {
      const rows = wrap(tokens, cols).map((slice, part) => ({
        ...(part === 0 && { line: offset + index }),
        tokens: slice,
      }))
      const open = pages.at(-1)
      if (open && open.length + rows.length <= capacity) {
        open.push(...rows)
        return pages
      }
      pages.push(rows)
      return pages
    }, [])
    .map((rows) => {
      const numbered = rows.filter((row) => row.line !== undefined)
      return { start: numbered[0]!.line!, end: numbered.at(-1)!.line!, rows }
    })
}

export const render = Effect.fn("ReadScreenshot.render")(function* (input: Input) {
  return yield* Effect.tryPromise(() => paint(input))
})

async function paint(input: Input): Promise<Rendered[]> {
  painter ??= setup().catch((error) => {
    painter = undefined
    throw error
  })
  const env = await painter
  const id = language(input.filepath)
  const expanded = input.lines.map((line) => line.replaceAll("\t", TAB))
  const result = env.highlighter.codeToTokens(expanded.join("\n"), {
    lang: id && env.highlighter.getLoadedLanguages().includes(id) ? id : "text",
    theme: THEME,
  })
  const last = input.offset + input.lines.length - 1
  const pages = paginate(result.tokens, input.offset)
  return pages.map((page, index) => ({
    start: page.start,
    end: page.end,
    url: png(
      env,
      svg({
        page,
        source: input,
        size: dimensions(last, pageColumns(page)),
        index,
        count: pages.length,
        fg: result.fg ?? "#1f2328",
        bg: result.bg ?? "#ffffff",
      }),
    ),
  }))
}

let painter: ReturnType<typeof setup> | undefined
let wasm: Promise<void> | undefined

async function setup() {
  const { createHighlighterCore } = await import("shiki/core")
  const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript")
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm")
  const { default: wasmFile } = await import("@resvg/resvg-wasm/index_bg.wasm" as string, { with: { type: "file" } })
  const { default: fontFile } = await import("./JetBrainsMonoNL-Regular.ttf" as string, { with: { type: "file" } })
  // resvg's wasm must only ever be initialized once per process, even if a
  // later part of setup fails and the whole thing is retried.
  wasm ??= initWasm(Bun.file(asset(wasmFile)).arrayBuffer())
  await wasm
  const highlighter = await createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs")],
    langs: [
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/jsx.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/jsonc.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/ruby.mjs"),
      import("shiki/langs/go.mjs"),
      import("shiki/langs/rust.mjs"),
      import("shiki/langs/java.mjs"),
      import("shiki/langs/kotlin.mjs"),
      import("shiki/langs/swift.mjs"),
      import("shiki/langs/c.mjs"),
      import("shiki/langs/cpp.mjs"),
      import("shiki/langs/csharp.mjs"),
      import("shiki/langs/php.mjs"),
      import("shiki/langs/shellscript.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/scss.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/toml.mjs"),
      import("shiki/langs/xml.mjs"),
      import("shiki/langs/vue.mjs"),
      import("shiki/langs/svelte.mjs"),
      import("shiki/langs/lua.mjs"),
      import("shiki/langs/docker.mjs"),
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  return {
    highlighter,
    Resvg,
    font: new Uint8Array(await Bun.file(asset(fontFile)).arrayBuffer()),
  }
}

// Bun's `type: "file"` imports yield absolute paths inside compiled binaries
// and module-relative paths when running from source.
function asset(file: string) {
  return path.isAbsolute(file) ? file : fileURLToPath(new URL(file, import.meta.url))
}

function wrap(tokens: Token[], cols: number) {
  const rows: Token[][] = [[]]
  let used = 0
  for (const token of tokens) {
    for (let text = token.content; text.length > 0; ) {
      if (used === cols) {
        rows.push([])
        used = 0
      }
      const piece = text.slice(0, cols - used)
      rows.at(-1)!.push({ ...token, content: piece })
      used += piece.length
      text = text.slice(piece.length)
    }
  }
  return rows
}

function svg(args: {
  page: Page
  source: Input
  size: ReturnType<typeof dimensions>
  index: number
  count: number
  fg: string
  bg: string
}) {
  const height = HEADER_HEIGHT + PADDING * 2 + args.page.rows.length * LINE_HEIGHT
  const top = PADDING + HEADER_HEIGHT
  const range =
    args.source.total === undefined
      ? `lines ${args.page.start}-${args.page.end}`
      : `lines ${args.page.start}-${args.page.end} of ${args.source.total}`
  const suffix = ` · ${range} · screenshot ${args.index + 1} of ${args.count}`
  const file = fit(args.source.path, args.size.cols + Math.floor(args.size.gutter / CHAR_WIDTH) - suffix.length)
  const rows = args.page.rows.flatMap((row, index) => {
    const y = top + (index + 1) * LINE_HEIGHT - 2.2
    const gutter =
      row.line === undefined
        ? `<text x="${PADDING + args.size.gutter - 8}" y="${y}" text-anchor="end" fill="${args.fg}" fill-opacity="0.3">${WRAP_MARKER}</text>`
        : `<text x="${PADDING + args.size.gutter - 8}" y="${y}" text-anchor="end" fill="${args.fg}" fill-opacity="0.4">${row.line}</text>`
    const code =
      row.tokens.length === 0
        ? ""
        : `<text x="${PADDING + args.size.gutter}" y="${y}" xml:space="preserve">${row.tokens.map((token) => span(token, args.fg)).join("")}</text>`
    return [gutter + code]
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${args.size.width}" height="${height}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`,
    `<rect width="100%" height="100%" fill="${args.bg}"/>`,
    `<text x="${PADDING}" y="${PADDING + FONT_SIZE + 2}" fill="${args.fg}" fill-opacity="0.55">${escape(file + suffix)}</text>`,
    `<line x1="${PADDING}" y1="${PADDING + HEADER_HEIGHT - 4}" x2="${args.size.width - PADDING}" y2="${PADDING + HEADER_HEIGHT - 4}" stroke="${args.fg}" stroke-opacity="0.15"/>`,
    ...rows,
    `</svg>`,
  ].join("")
}

function span(token: Token, fg: string) {
  // FontStyle is a bitmask where -1 means "not set" — only positive values
  // carry style bits.
  const style = token.fontStyle !== undefined && token.fontStyle > 0 ? token.fontStyle : 0
  const italic = style & 1 ? ` font-style="italic"` : ""
  const bold = style & 2 ? ` font-weight="bold"` : ""
  return `<tspan fill="${token.color ?? fg}"${italic}${bold}>${escape(token.content)}</tspan>`
}

function png(env: Awaited<ReturnType<typeof setup>>, markup: string) {
  const renderer = new env.Resvg(markup, {
    font: { fontBuffers: [env.font], defaultFontFamily: FONT_FAMILY, monospaceFamily: FONT_FAMILY },
  })
  const image = renderer.render()
  const data = Buffer.from(image.asPng()).toString("base64")
  image.free()
  renderer.free()
  return `data:image/png;base64,${data}`
}

// Keep the header on one row; long paths keep their tail, which carries the
// filename the model needs for continuity across pages.
function fit(text: string, max: number) {
  const room = Math.max(10, max)
  if (text.length <= room) return text
  return `…${text.slice(text.length - room + 1)}`
}

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  lua: "lua",
  dockerfile: "docker",
}

export * as ReadScreenshot from "./read-screenshot"
