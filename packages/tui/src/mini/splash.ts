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
  push(
    lines,
    body_left + label.length,
    top + 1,
    `opencode mini -s ${meta.session_id}`,
    right,
    undefined,
    TextAttributes.BOLD,
  )
  const height = top + Math.max(mark.length, 2)
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
    const label = `${input.mono ? "#" : "▪"} oc mini`
    const metadata = ` v${input.version}${input.detail ? ` ${input.mono ? "-" : "·"} ` : ""}`
    const available = Math.max(0, width - stringWidth(label + metadata))
    const detail = input.detail ?? ""
    const ellipsis = input.mono ? "..." : "…"
    const suffix = Locale.graphemes(
      Locale.takeWidth(
        Locale.graphemes(detail).reverse().join(""),
        Math.max(0, Math.floor((available - ellipsis.length) / 2)),
      ),
    )
      .reverse()
      .join("")
    const path =
      stringWidth(detail) <= available
        ? detail
        : available <= ellipsis.length
          ? ellipsis.slice(0, available)
          : Locale.takeWidth(detail, available - ellipsis.length - stringWidth(suffix)) + ellipsis + suffix
    const root = new BoxRenderable(ctx.renderContext, {
      width,
      height: 2,
      paddingTop: 1,
      flexDirection: "row",
      overflow: "hidden",
    })
    root.add(
      new TextRenderable(ctx.renderContext, {
        content: new StyledText([fg(input.theme.right)(label), fg(input.theme.left)(metadata + path)]),
        width,
        height: 1,
        wrapMode: "none",
      }),
    )
    return { root, width, height: 2, rowColumns: width, startOnNewLine: true, trailingNewline: false }
  }
}

export function exitSplash(input: SplashWriterInput): ScrollbackWriter {
  return (ctx) => buildExit(input, ctx)
}
