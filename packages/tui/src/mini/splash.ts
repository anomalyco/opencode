// Entry and exit splash banners for direct interactive mode scrollback.
//
// The entry header is a single flex row; the exit banner retains its cell-based
// logo and resume information. Both become immutable terminal history.
import {
  BoxRenderable,
  type ColorInput,
  TextAttributes,
  TextRenderable,
  StyledText,
  fg,
  type ScrollbackRenderContext,
  type ScrollbackSnapshot,
  type ScrollbackWriter,
} from "@opentui/core"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { go } from "../logo"
import { monoTruncate } from "./mono"
import type { RunSplashTheme } from "./theme"

const SPLASH_TITLE_LIMIT = 50
const SPLASH_TITLE_FALLBACK = "Untitled session"

type SplashInput = {
  title: string | undefined
  session_id: string
  mono?: boolean
}

type SplashWriterInput = SplashInput & {
  theme: RunSplashTheme
  showSession?: boolean
}

export type SplashMeta = {
  title: string
  session_id: string
}

type Cell = {
  char: string
  mark: "text" | "full" | "mix" | "top"
}

function cells(line: string): Cell[] {
  const list: Cell[] = []
  for (const char of line) {
    if (char === "_") {
      list.push({ char: " ", mark: "full" })
      continue
    }

    if (char === "^") {
      list.push({ char: "▀", mark: "mix" })
      continue
    }

    if (char === "~") {
      list.push({ char: "▀", mark: "top" })
      continue
    }

    list.push({ char, mark: "text" })
  }

  return list
}

function title(text: string | undefined, mono = false): string {
  if (!text) {
    return SPLASH_TITLE_FALLBACK
  }

  let value = ""
  let gap = false
  for (const char of text.trim()) {
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      gap = true
      continue
    }

    if (gap && value.length > 0) {
      value += " "
    }

    value += char
    gap = false
  }

  if (!value) {
    return SPLASH_TITLE_FALLBACK
  }

  return mono ? monoTruncate(value, SPLASH_TITLE_LIMIT, true) : Locale.truncate(value, SPLASH_TITLE_LIMIT)
}

function write(
  root: BoxRenderable,
  ctx: ScrollbackRenderContext,
  line: {
    left: number
    top: number
    text: string
    fg: ColorInput
    bg?: ColorInput
    attrs?: number
  },
): void {
  if (line.left >= ctx.width) {
    return
  }

  root.add(
    new TextRenderable(ctx.renderContext, {
      position: "absolute",
      left: line.left,
      top: line.top,
      width: Math.max(1, ctx.width - line.left),
      height: 1,
      wrapMode: "none",
      content: line.text,
      fg: line.fg,
      bg: line.bg,
      attributes: line.attrs,
    }),
  )
}

function push(
  lines: Array<{ left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }>,
  left: number,
  top: number,
  text: string,
  fg: ColorInput,
  bg?: ColorInput,
  attrs?: number,
): void {
  lines.push({ left, top, text, fg, bg, attrs })
}

function draw(
  lines: Array<{ left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }>,
  row: string,
  input: {
    left: number
    top: number
    fg: ColorInput
    shadow: ColorInput
    attrs?: number
  },
) {
  let x = input.left
  for (const cell of cells(row)) {
    if (cell.mark === "full" || cell.mark === "mix") {
      push(lines, x, input.top, cell.char, input.fg, input.shadow, input.attrs)
      x += 1
      continue
    }

    if (cell.mark === "top") {
      push(lines, x, input.top, cell.char, input.shadow, undefined, input.attrs)
      x += 1
      continue
    }

    push(lines, x, input.top, cell.char, input.fg, undefined, input.attrs)
    x += 1
  }
}

function buildExit(input: SplashWriterInput, ctx: ScrollbackRenderContext): ScrollbackSnapshot {
  const width = Math.max(1, ctx.width)
  const meta = splashMeta(input)
  const lines: Array<{ left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }> = []
  const left = input.theme.left
  const right = input.theme.right
  const leftShadow = input.theme.leftShadow
  const mark = input.mono ? ["[O]"] : go.right.slice(1)
  const top = 1
  const body_left = (mark[0]?.length ?? 0) + 2
  const session = "Session  "
  const label = "Continue "
  const command = `opencode mini -s ${meta.session_id}`
  const wide = body_left + stringWidth(label + command) <= width
  const commandHeight = wide ? 1 : Math.ceil(stringWidth(command) / width)

  if (wide) {
    for (let i = 0; i < mark.length; i += 1) {
      draw(lines, mark[i] ?? "", {
        left: 0,
        top: top + i,
        fg: left,
        shadow: leftShadow,
      })
    }

    if (input.showSession !== false) {
      push(lines, body_left, top, session, left)
      push(lines, body_left + session.length, top, meta.title, right, undefined, TextAttributes.BOLD)
    }
    push(lines, body_left, top + 1, label, left)
  }

  const height = top + (wide ? Math.max(mark.length, 2) : commandHeight)
  const root = new BoxRenderable(ctx.renderContext, {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
  })

  for (const line of lines) {
    write(root, ctx, line)
  }
  root.add(
    new TextRenderable(ctx.renderContext, {
      position: "absolute",
      left: wide ? body_left + label.length : 0,
      top: wide ? top + 1 : top,
      width: wide ? width - body_left - label.length : width,
      height: commandHeight,
      wrapMode: "char",
      content: command,
      fg: right,
      attributes: TextAttributes.BOLD,
    }),
  )

  return {
    root,
    width,
    height,
    rowColumns: width,
    startOnNewLine: true,
    trailingNewline: false,
  }
}

export function splashMeta(input: SplashInput): SplashMeta {
  return {
    title: title(input.title, input.mono),
    session_id: input.session_id,
  }
}

export function entrySplash(input: {
  version: string
  detail?: string
  mono?: boolean
  theme: RunSplashTheme
}): ScrollbackWriter {
  return (ctx) => {
    const width = Math.max(1, ctx.width)
    const layout = entrySplashLayout({ ...input, width })
    const root = new BoxRenderable(ctx.renderContext, {
      width,
      height: 2,
      paddingTop: 1,
      flexDirection: "row",
      overflow: "hidden",
    })
    root.add(
      new TextRenderable(ctx.renderContext, {
        content: new StyledText([fg(input.theme.right)(layout.label), fg(input.theme.left)(layout.metadata)]),
        width,
        height: 1,
        wrapMode: "none",
      }),
    )
    return { root, width, height: 2, rowColumns: width, startOnNewLine: true, trailingNewline: false }
  }
}

export function entrySplashLayout(input: { width: number; version: string; detail?: string; mono?: boolean }) {
  const detail = input.detail ?? ""
  const segments = detail.split(/[/\\]/).filter(Boolean)
  const leaf = segments.at(-1) ?? detail
  const separator = input.mono ? " - " : " · "
  const ellipsis = input.mono ? "..." : "…"
  const slash = detail.includes("\\") ? "\\" : "/"
  const paths = segments
    .slice(1)
    .map((_, index) => ellipsis + slash + segments.slice(index + 1).join(slash))
    .reverse()
    .filter((path) => stringWidth(path) < stringWidth(detail))
  let layout = { label: Locale.takeWidth("oc mini", input.width), version: "", path: "", metadata: "" }
  const stages = [
    { label: `${input.mono ? "[O]" : "▪"} oc mini` },
    ...(leaf ? [{ path: leaf }] : []),
    ...(input.version ? [{ version: input.version }] : []),
    ...paths.concat(detail ? [detail] : []).map((path) => ({ path })),
  ]
  // Stop at the first non-fitting stage instead of backfilling lower-priority metadata.
  for (const stage of stages) {
    const next = { ...layout, ...stage }
    const metadata = (next.version ? ` v${next.version}` : "") + (next.path ? separator + next.path : "")
    if (stringWidth(next.label + metadata) > input.width) break
    layout = { ...next, metadata }
  }
  return layout
}

export function exitSplash(input: SplashWriterInput): ScrollbackWriter {
  return (ctx) => buildExit(input, ctx)
}
