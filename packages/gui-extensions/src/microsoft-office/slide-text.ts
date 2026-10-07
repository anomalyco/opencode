import { Option, Schema } from "effect"
import { inspectPresentation, type DeckSnapshot } from "@betteroffice/pptx"

/** A text style a deck draws with. */
export type FontStyle = { readonly bold: boolean; readonly italic: boolean }

/** A family the deck names, with the styles its text asks for. */
export type DeckFamily = { readonly name: string; readonly styles: readonly FontStyle[] }

/** The scripts the bundled Latin faces may lack, which have a bundled fallback face. */
export type FallbackScript = "hebrew" | "arabic"

/** What a deck's text needs from the fonts, and which slides it hides. */
export type DeckText = {
  /** Most important first: the face registered first also draws every family the deck names but nobody found. */
  readonly families: readonly DeckFamily[]
  readonly scripts: readonly FallbackScript[]
  /** One flag per slide, in deck order. */
  readonly hidden: readonly boolean[]
}

const RunStyle = Schema.Struct({
  bold: Schema.optional(Schema.NullOr(Schema.Boolean)),
  italic: Schema.optional(Schema.NullOr(Schema.Boolean)),
  fontFamily: Schema.optional(Schema.NullOr(Schema.String)),
})

const Body = Schema.Struct({
  paragraphs: Schema.Array(
    Schema.Struct({
      runs: Schema.Array(Schema.Struct({ text: Schema.String, properties: Schema.optional(Schema.NullOr(RunStyle)) })),
    }),
  ),
})

type Drawing = {
  readonly text?: typeof Body.Type | null | undefined
  readonly children?: readonly Drawing[] | undefined
  readonly data?: typeof Table.Type | null | undefined
}

const Table = Schema.Struct({
  rows: Schema.optional(
    Schema.Array(Schema.Struct({ cells: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.NullOr(Body)) })) })),
  ),
})

/** A slide object: a shape, group, picture or graphic frame. */
const Drawing: Schema.Codec<Drawing> = Schema.Struct({
  text: Schema.optional(Schema.NullOr(Body)),
  children: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<Drawing> => Drawing))),
  // A table's cells; other frames, such as charts, carry no rows.
  data: Schema.optional(Schema.NullOr(Table)),
})

const ThemeFont = Schema.Struct({ latin: Schema.String })

const Inspected = Schema.Struct({
  slides: Schema.Array(
    Schema.Struct({ hidden: Schema.optional(Schema.Boolean), drawings: Schema.Array(Drawing) }).pipe(
      Schema.encodeKeys({ drawings: "shapes" }),
    ),
  ),
  layouts: Schema.optional(
    Schema.Array(Schema.Struct({ drawings: Schema.Array(Drawing) }).pipe(Schema.encodeKeys({ drawings: "shapes" }))),
  ),
  masters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        drawings: Schema.Array(Drawing),
        textStyles: Schema.optional(
          Schema.NullOr(
            Schema.Record(
              Schema.String,
              Schema.Array(Schema.Struct({ defaultRun: Schema.optional(Schema.NullOr(RunStyle)) })),
            ),
          ),
        ),
      }).pipe(Schema.encodeKeys({ drawings: "shapes" })),
    ),
  ),
  themes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        theme: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              fontScheme: Schema.optional(Schema.NullOr(Schema.Struct({ majorFont: ThemeFont, minorFont: ThemeFont }))),
            }),
          ),
        ),
      }),
    ),
  ),
})

const decodeInspected = Schema.decodeUnknownOption(Inspected)

const scriptRanges: readonly (readonly [FallbackScript, RegExp])[] = [
  ["hebrew", /[\u0590-\u05FF\uFB1D-\uFB4F]/u],
  ["arabic", /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u],
]

/**
 * Reads the families, styles and scripts a deck's text uses, from its slides, layouts, masters and theme. When the
 * engine's inspection does not decode, the slides' own runs stand in, without theme fonts or hidden flags.
 */
export function deckText(bytes: Uint8Array, snapshot: DeckSnapshot): DeckText {
  return Option.match(decodeInspected(inspectPresentation(withoutMedia(bytes))), {
    onNone: () => fromSnapshot(snapshot),
    onSome: (inspected) => {
      const scheme = inspected.themes?.flatMap((theme) => (theme.theme?.fontScheme ? [theme.theme.fontScheme] : []))[0]
      const major = scheme?.majorFont.latin ?? ""
      const minor = scheme?.minorFont.latin ?? ""

      const drawings = [
        ...inspected.slides.flatMap((slide) => slide.drawings),
        ...(inspected.layouts ?? []).flatMap((layout) => layout.drawings),
        ...(inspected.masters ?? []).flatMap((master) => master.drawings),
      ]

      const defaults = (inspected.masters ?? []).flatMap((master) =>
        Object.values(master.textStyles ?? {}).flatMap((levels) =>
          levels.flatMap((level) => (level.defaultRun ? [{ text: "", style: level.defaultRun }] : [])),
        ),
      )

      return summarize(
        [...drawings.flatMap(drawingRuns), ...defaults],
        (family) => {
          if (!family || family.startsWith("+mn")) return minor

          if (family.startsWith("+mj")) return major

          if (family.startsWith("+")) return ""

          return family
        },
        minor,
        inspected.slides.map((slide) => slide.hidden ?? false),
      )
    },
  })
}

/** A file in the deck's zip package: where its central directory record and its local data sit. */
type Entry = { readonly name: string; readonly record: number; readonly length: number; readonly local: number }

/**
 * The package without its pictures and media. The inspection reads only the deck's text and styles, but returns every
 * picture as base64, which for a deck of photos costs tens of megabytes of engine memory the worker never gives back.
 * Entries keep their compressed bytes. A package this cannot read, such as a ZIP64 one, stays as it is.
 */
export function withoutMedia(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = endOfDirectory(view)

  if (end === undefined) return bytes

  const count = view.getUint16(end + 10, true)
  const directory = view.getUint32(end + 16, true)

  if (count === 0xffff || directory === 0xffffffff || directory > end) return bytes

  const entries = readEntries(view, directory, end, count)

  if (!entries || !entries.some((entry) => entry.name.startsWith("ppt/media/"))) return bytes

  // An entry's local header and data run up to the next entry's, or to the central directory.
  const starts = entries.map((entry) => entry.local).toSorted((left, right) => left - right)

  const kept = entries
    .filter((entry) => !entry.name.startsWith("ppt/media/"))
    .map((entry) => ({ entry, start: entry.local, end: starts.find((start) => start > entry.local) ?? directory }))

  // Where each kept entry's local data and directory record land in the new package.
  const locals = offsets(kept.map((part) => part.end - part.start))
  const records = offsets(kept.map((part) => part.entry.length))
  const size = locals.at(-1) ?? 0
  const directorySize = records.at(-1) ?? 0
  const out = new Uint8Array(size + directorySize + 22)
  const writer = new DataView(out.buffer)

  kept.forEach((part, index) => {
    const local = locals[index] ?? 0
    const record = size + (records[index] ?? 0)

    out.set(bytes.subarray(part.start, part.end), local)
    out.set(bytes.subarray(part.entry.record, part.entry.record + part.entry.length), record)
    writer.setUint32(record + 42, local, true)
  })

  const tail = size + directorySize

  out.set(bytes.subarray(end, end + 22), tail)
  writer.setUint16(tail + 8, kept.length, true)
  writer.setUint16(tail + 10, kept.length, true)
  writer.setUint32(tail + 12, directorySize, true)
  writer.setUint32(tail + 16, size, true)
  writer.setUint16(tail + 20, 0, true)

  return out
}

/** Where each length starts when they are laid end to end, then where the last ends. */
function offsets(lengths: readonly number[]) {
  return lengths.reduce(
    (list, length) => {
      list.push((list.at(-1) ?? 0) + length)

      return list
    },
    [0],
  )
}

/** Where the end of central directory record starts, searched back from the end past any comment. */
function endOfDirectory(view: DataView) {
  const last = view.byteLength - 22
  const first = Math.max(0, last - 0xffff)

  for (let at = last; at >= first; at--) if (view.getUint32(at, true) === 0x06054b50) return at

  return undefined
}

/**
 * The central directory's records, from `directory` up to the end record at `end`; undefined when one is malformed: it
 * runs past the directory, or its local header does not sit before it.
 */
function readEntries(view: DataView, directory: number, end: number, count: number) {
  const decoder = new TextDecoder()

  return Array.from({ length: count }).reduce<{ at: number; entries: Entry[] } | undefined>(
    (state) => {
      if (!state || state.at + 46 > end || view.getUint32(state.at, true) !== 0x02014b50) return undefined

      const nameLength = view.getUint16(state.at + 28, true)
      const length = 46 + nameLength + view.getUint16(state.at + 30, true) + view.getUint16(state.at + 32, true)
      const local = view.getUint32(state.at + 42, true)

      // A local header is 30 bytes before its name and data.
      if (state.at + length > end || local + 30 > directory) return undefined

      const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + state.at + 46, nameLength))

      state.entries.push({ name, record: state.at, length, local })

      return { at: state.at + length, entries: state.entries }
    },
    { at: directory, entries: [] },
  )?.entries
}

type Run = { readonly text: string; readonly style: typeof RunStyle.Type | null | undefined }

function drawingRuns(drawing: Drawing): Run[] {
  return [
    ...bodyRuns(drawing.text),
    ...(drawing.data?.rows ?? []).flatMap((row) => row.cells.flatMap((cell) => bodyRuns(cell.text))),
    ...(drawing.children ?? []).flatMap(drawingRuns),
  ]
}

function bodyRuns(body: typeof Body.Type | null | undefined): Run[] {
  return (body?.paragraphs ?? []).flatMap((paragraph) =>
    paragraph.runs.map((run) => ({ text: run.text, style: run.properties })),
  )
}

function fromSnapshot(snapshot: DeckSnapshot): DeckText {
  const runs = (drawings: DeckSnapshot["slides"][number]["shapes"]): Run[] =>
    drawings.flatMap((drawing) => [
      ...drawing.textStories.flatMap((story) =>
        story.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => ({ text: run.text, style: run.style }))),
      ),
      ...runs(drawing.children),
    ])

  return summarize(
    snapshot.slides.flatMap((slide) => runs(slide.shapes)),
    (family) => family ?? "",
    "",
    snapshot.slides.map(() => false),
  )
}

/**
 * Groups runs by the family they resolve to: the theme's body font first, then by how much text each draws. The
 * masters' default runs count too, so a theme font that placeholders inherit without naming it is still found.
 */
function summarize(
  runs: readonly Run[],
  resolve: (family: string | null | undefined) => string,
  theme: string,
  hidden: readonly boolean[],
): DeckText {
  const families = new Map<string, { name: string; weight: number; styles: Map<string, FontStyle> }>()
  const body = theme.trim().toLowerCase()
  const text = runs.map((run) => run.text).join("")

  runs.forEach((run) => {
    const name = resolve(run.style?.fontFamily).trim()

    if (!name) return

    const style = { bold: run.style?.bold ?? false, italic: run.style?.italic ?? false }
    const family = families.get(name.toLowerCase()) ?? { name, weight: 0, styles: new Map<string, FontStyle>() }

    family.weight += run.text.length
    family.styles.set(`${style.bold}|${style.italic}`, style)
    families.set(name.toLowerCase(), family)
  })

  return {
    families: [...families.entries()]
      .toSorted((left, right) => rank(right, body) - rank(left, body))
      .map((entry) => ({
        name: entry[1].name,
        // Regular first, so a family's first face is the one its unstyled text draws with.
        styles: [...entry[1].styles.values()].toSorted((left, right) => styleRank(left) - styleRank(right)),
      })),
    scripts: scriptRanges.flatMap((entry) => (entry[1].test(text) ? [entry[0]] : [])),
    hidden,
  }
}

function rank(entry: readonly [string, { readonly weight: number }], body: string) {
  return entry[0] === body ? Number.POSITIVE_INFINITY : entry[1].weight
}

function styleRank(style: FontStyle) {
  return (style.bold ? 1 : 0) + (style.italic ? 2 : 0)
}
