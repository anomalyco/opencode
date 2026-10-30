import type { SimpleHighlight } from "@opentui/core"

// Longer messages stay plain: a pasted log is not worth a parse.
export const USER_MARKDOWN_LIMIT = 100_000

// Markdown highlights for text a person typed, kept where they read as the person meant them.
// People write markdown loosely, so the constructs a strict parser finds by accident are dropped:
//
// - a setext heading: a line followed by `---` or `===`, which people write as a separator;
// - an indented code block: four leading spaces, which people write for alignment or pasted logs;
// - a block quote's lazy continuation: lines after a `>` line that do not start with `>`;
// - emphasis inside a word, as in `2*3*4`, and the markers around it;
// - `spell`/`nospell`, which carry no color and would paint over the colors under them.
//
// Every highlight only colors characters: nothing is hidden or moved.
export function forgivingMarkdown(text: string, highlights: SimpleHighlight[]): SimpleHighlight[] {
  const dropped = highlights.filter((highlight) => accidental(text, highlight))
  const markers = new Set(
    dropped.flatMap(([start, end, group]) =>
      group === "markup.italic" || group === "markup.strong" ? markerOffsets(text, start, end) : [],
    ),
  )
  return highlights.flatMap((highlight): SimpleHighlight[] => {
    const [start, end, group] = highlight
    if (end <= start || dropped.includes(highlight)) return []
    if (group === "conceal" && markers.has(start)) return []
    if (group === "markup.quote") return quotedLines(text, start, end).map(([from, to]) => [from, to, group])
    return [highlight]
  })
}

function accidental(text: string, [start, end, group]: SimpleHighlight) {
  const body = text.slice(start, end).trimStart()
  if (group === "spell" || group === "nospell") return true
  if (/^markup\.heading\.\d$/.test(group)) return !body.startsWith("#")
  if (group === "markup.raw.block") return !body.startsWith("```") && !body.startsWith("~~~")
  if (group === "markup.italic" || group === "markup.strong")
    return wordCharacter(text[start - 1]) && wordCharacter(text[end])
  return false
}

// The offsets of the emphasis markers at both ends of `start`..`end`.
function markerOffsets(text: string, start: number, end: number) {
  const marker = text[start]
  const width = text.startsWith(marker.repeat(2), start) && text.startsWith(marker.repeat(2), end - 2) ? 2 : 1
  return Array.from({ length: width }, (_, index) => [start + index, end - width + index]).flat()
}

// The lines of `start`..`end` that start with `>`, as ranges.
function quotedLines(text: string, start: number, end: number) {
  const ranges: [number, number][] = []
  let from = start
  while (from < end) {
    const newline = text.indexOf("\n", from)
    const to = newline === -1 || newline >= end ? end : newline + 1
    if (/^ {0,3}>/.test(text.slice(lineStart(text, from), to))) ranges.push([from, to])
    from = to
  }
  return ranges
}

function lineStart(text: string, offset: number) {
  return text.lastIndexOf("\n", offset - 1) + 1
}

function wordCharacter(char: string | undefined) {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}
