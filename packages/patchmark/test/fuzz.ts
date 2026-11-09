// Seeded Markdown generator and mutator for differential fuzzing against commonmark.js (core) and
// micromark + micromark-extension-gfm (GFM). Biased toward nesting, lists, emphasis, fences, and tables.
import * as commonmark from "commonmark"
import { tests as specTests } from "commonmark-spec"
import { micromark } from "micromark"
import { gfm, gfmHtml } from "micromark-extension-gfm"
import { createMarkdownStream, renderBlocksToHtml } from "../src/index"

export function rng(seed: number) {
  let s = seed >>> 0 || 1

  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0

    return s / 0x100000000
  }
}

const PREFIXES = ["", "", "", "- ", "* ", "+ ", "1. ", "2) ", "10. ", "> ", "  ", "   ", "    ", "\t", "-   ", "1.  "]
const LEADERS = [
  "# ",
  "## ",
  "###### ",
  "```",
  "~~~",
  "````js",
  "```py x",
  "---",
  "***",
  "___",
  "===",
  "- - -",
  "<div>",
  "</div>",
  "<!-- c -->",
  "<pre>",
  "</pre>",
  "[x]: /url",
  '[y]: <a b> "t"',
  "[Foo bar]:\n/u",
  "    code",
  "",
]
const TABLE = ["| a | b |", "|---|---|", "| - | :-: |", "a | b", "--|--", "| x |", "|:--|", "| `c|d` | e\\|f |"]
const INLINE = [
  "foo",
  "bar",
  "baz",
  "*",
  "**",
  "***",
  "_",
  "__",
  "`",
  "``",
  "[",
  "]",
  "(",
  ")",
  "![",
  "<",
  ">",
  "&amp;",
  "&#35;",
  "&nope;",
  "\\",
  "\\*",
  "\\_",
  "~",
  "~~",
  "~~~",
  "http://a.b/c",
  "www.x.com",
  "a@b.co",
  "<http://x.y>",
  "<a@b.c>",
  "<span>",
  "</span>",
  "[a](b)",
  '[a](<b c> "t")',
  "[x]",
  "[x][]",
  "[y][x]",
  "![i](s)",
  "  ",
  " ",
  "\t",
  "  \n",
  "\\\n",
  "*a*",
  "**b**",
  "_c_",
  "__d__",
  "`e`",
  "a*b",
  "a_b",
  "*(",
  ")*",
  '"',
  "'",
  "ä",
  "😀",
  "[ ]",
  "[x]",
  "---",
  "1.",
  "#",
  "|",
]

function inlineText(r: () => number, max: number): string {
  let out = ""
  const n = 1 + Math.floor(r() * max)

  for (let i = 0; i < n; i++) {
    out += INLINE[Math.floor(r() * INLINE.length)]!

    if (r() < 0.5) out += " "
  }

  return out
}

export function generate(r: () => number, gfmMode: boolean): string {
  const lines: string[] = []
  const count = 1 + Math.floor(r() * 8)

  for (let i = 0; i < count; i++) {
    let line = ""
    const depth = Math.floor(r() * r() * 4)

    for (let d = 0; d < depth; d++) line += PREFIXES[Math.floor(r() * PREFIXES.length)]!
    const roll = r()

    if (gfmMode && roll < 0.15) line += TABLE[Math.floor(r() * TABLE.length)]!
    else if (roll < 0.4) line += LEADERS[Math.floor(r() * LEADERS.length)]! + (r() < 0.5 ? inlineText(r, 3) : "")
    else if (roll < 0.5) line += ""
    else line += inlineText(r, 6)
    lines.push(line)
  }

  return lines.join("\n") + (r() < 0.7 ? "\n" : "")
}

const SPECIALS = "*_`[]()!<>&\\~|#-+=:.> \n\t1"
const specExamples: string[] = specTests.map((e) => e.markdown.replace(/→/g, "\t"))

export function mutate(r: () => number): string {
  let s = specExamples[Math.floor(r() * specExamples.length)]!
  const edits = 1 + Math.floor(r() * 4)

  for (let e = 0; e < edits; e++) {
    const at = Math.floor(r() * (s.length + 1))
    const roll = r()

    if (roll < 0.4) s = s.slice(0, at) + SPECIALS[Math.floor(r() * SPECIALS.length)] + s.slice(at)
    else if (roll < 0.7) s = s.slice(0, at) + s.slice(at + 1)
    else {
      const other = specExamples[Math.floor(r() * specExamples.length)]!
      const from = Math.floor(r() * other.length)
      s = s.slice(0, at) + other.slice(from, from + 1 + Math.floor(r() * 12)) + s.slice(at)
    }
  }

  return s
}

const cmParser = new commonmark.Parser()
const cmRenderer = new commonmark.HtmlRenderer()

export function referenceCore(md: string): string {
  return cmRenderer.render(cmParser.parse(md))
}

export function referenceGfm(md: string): string {
  return micromark(md, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] })
}

export function patchmark(md: string, gfmMode: boolean): string {
  const opts = { gfm: gfmMode, math: false }

  return renderBlocksToHtml(createMarkdownStream(opts).update(md, { streaming: false }).blocks, opts)
}

/** Normalize insignificant HTML differences between renderers (whitespace between tags, void-tag syntax, attribute order) */
export function normalizeHtml(html: string): string {
  return html
    .replace(/<input ([^>]*?)\s*\/?>/g, (_m, attrs: string) => `<input ${attrs.trim().split(/\s+/).sort().join(" ")}>`)
    .replace(/(<input [^>]+>)\n/g, "$1 ")
    .replace(/<(br|hr|img[^>]*?)\s*\/?>/g, "<$1>")
    .replace(/\s+<\/li>/g, "</li>")
    .replace(/>\s+</g, "><")
    .replace(/\s+$/g, "")
    .replace(/^\s+/g, "")
}
