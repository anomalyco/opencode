import {
  BoxRenderable,
  CodeRenderable,
  MarkdownRenderable,
  RGBA,
  Renderable,
  StyledText,
  TextRenderable,
  TextTableRenderable,
  isStyledText,
  stringToStyledText,
  type BorderCharacters,
  type CliRendererExternalOutputEvent,
  type TreeSitterClient,
} from "@opentui/core"

const prefixes: Record<number, string> = {
  0x2192: "->",
  0x2190: "<-",
  0x2731: "*",
  0x2699: "*",
  0x2716: "!",
  0x2717: "!",
  0x25c8: "*",
  0x25c9: "*",
  0x27f3: "*",
}

const markdown: Record<number, string> = {
  ...prefixes,
  0x00a0: " ",
  0x00b7: "-",
  0x2010: "-",
  0x2011: "-",
  0x2012: "-",
  0x2013: "-",
  0x2014: "--",
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2022: "*",
  0x2026: "...",
  0x2191: "up",
  0x2193: "down",
}

const asciiBorder: BorderCharacters = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  topT: "+",
  bottomT: "+",
  leftT: "+",
  rightT: "+",
  cross: "+",
}

const hooked = new WeakSet<Renderable>()

export const monoMarkdownTableOptions = {
  style: "columns" as const,
  widthMode: "content" as const,
  borders: false,
}

export function monoMarkdownRenderable(renderable: MarkdownRenderable): void {
  monoRenderable(renderable)
}

function monoRenderable(renderable: Renderable): void {
  if (hooked.has(renderable)) return
  hooked.add(renderable)
  // Markdown reconciles nested lists and tables without calling renderNode.
  // Hook the actual tree so future descendants are transformed before layout.
  const add = renderable.add.bind(renderable)
  renderable.add = (child, index) => {
    if (child instanceof Renderable) monoRenderable(child)
    return add(child, index)
  }

  if (renderable instanceof BoxRenderable) renderable.customBorderChars = asciiBorder
  if (renderable instanceof CodeRenderable) monoCode(renderable)
  if (renderable instanceof TextRenderable) renderable.content = monoStyledText(renderable.content)
  if (renderable instanceof TextTableRenderable) monoTable(renderable)
  renderable.getChildren().forEach(monoRenderable)
}

function monoCode(renderable: CodeRenderable): void {
  const onChunks = renderable.onChunks
  renderable.onChunks = async (chunks, context) => monoChunks((await onChunks?.(chunks, context)) ?? chunks)
  renderable.treeSitterClient = monoTreeSitter(renderable.treeSitterClient)

  const initialDescriptor = Object.getOwnPropertyDescriptor(CodeRenderable.prototype, "initialStyledText")
  const contentDescriptor = Object.getOwnPropertyDescriptor(CodeRenderable.prototype, "content")
  if (!initialDescriptor?.set || !contentDescriptor?.get || !contentDescriptor.set) return
  const initialSetter = initialDescriptor.set.bind(renderable)
  const contentGetter = contentDescriptor.get.bind(renderable)
  const contentSetter = contentDescriptor.set.bind(renderable)
  const initial = Reflect.get(renderable, "_initialStyledText")
  Object.defineProperty(renderable, "initialStyledText", {
    configurable: true,
    set(value: StyledText | undefined) {
      initialSetter(value ? monoStyledText(value) : value)
    },
  })
  Object.defineProperty(renderable, "content", {
    configurable: true,
    get: contentGetter,
    set(value: string) {
      if (renderable.filetype !== "markdown" || !isStyledText(Reflect.get(renderable, "_initialStyledText"))) {
        renderable.drawUnstyledText = true
        renderable.initialStyledText = stringToStyledText(value)
      }
      contentSetter(renderable.filetype === "markdown" ? value : monoText(value))
    },
  })

  if (isStyledText(initial)) {
    renderable.initialStyledText = initial
  } else {
    renderable.drawUnstyledText = true
    renderable.initialStyledText = stringToStyledText(renderable.content)
  }
  if (!renderable.drawUnstyledText) return

  // Refresh the eager buffer with the transformed initial text. Highlighted
  // chunks continue through onChunks without changing the Markdown source.
  const content = renderable.content
  renderable.content = ""
  renderable.content = content
}

function monoTreeSitter(client: TreeSitterClient): TreeSitterClient {
  return new Proxy(client, {
    get(target, property) {
      if (property !== "highlightOnce") return Reflect.get(target, property, target)
      // Keep parser failures on the chunk path instead of OpenTUI's raw-text fallback.
      return (...args: Parameters<TreeSitterClient["highlightOnce"]>) =>
        target.highlightOnce(...args).catch(() => ({ highlights: [] }))
    },
  })
}

function monoTable(renderable: TextTableRenderable): void {
  const descriptor = Object.getOwnPropertyDescriptor(TextTableRenderable.prototype, "content")
  if (!descriptor?.get || !descriptor.set) return
  const cells = new WeakMap<StyledText["chunks"], StyledText["chunks"]>()
  const content = renderable.content
  Object.defineProperty(renderable, "content", {
    configurable: true,
    get: () => descriptor.get!.call(renderable),
    set: (value: TextTableRenderable["content"]) => {
      descriptor.set!.call(
        renderable,
        value.map((row) =>
          row.map((cell) => {
            if (!cell) return cell
            const cached = cells.get(cell)
            if (cached) return cached
            const next = monoChunks(cell)
            cells.set(cell, next)
            return next
          }),
        ),
      )
    },
  })
  renderable.content = content
}

function monoStyledText(value: StyledText): StyledText {
  return new StyledText(monoChunks(value.chunks))
}

function monoChunks(value: StyledText["chunks"]): StyledText["chunks"] {
  return value.map((chunk) => ({ ...chunk, text: monoText(chunk.text) }))
}

function monoText(value: string): string {
  return value.replace(/[^\t\n\x20-\x7e]/gu, (char) => markdown[char.codePointAt(0)!] ?? "?")
}

export function monoSnapshot(event: CliRendererExternalOutputEvent): void {
  const buffers = event.snapshot.buffers
  const chars = buffers.char
  for (let index = 0; index < chars.length; index += 1) {
    const point = chars[index]
    if (point <= 0x7f) continue
    const offset = index * 4
    event.snapshot.setCell(
      index % event.snapshot.width,
      Math.floor(index / event.snapshot.width),
      monoCell(point),
      RGBA.fromArray(buffers.fg.subarray(offset, offset + 4)),
      RGBA.fromArray(buffers.bg.subarray(offset, offset + 4)),
      buffers.attributes[index],
    )
  }
}

function monoCell(point: number): string {
  const kind = point >>> 30
  if (kind === 2) return "?"
  if (kind === 3) return " "
  if (point === 0x2500) return "-"
  if (point === 0x2502) return "|"
  return markdown[point]?.[0] ?? "?"
}

export function monoPrefix(value: string, mono: boolean): string {
  if (!mono) return value
  const point = value.codePointAt(0)
  if (point === undefined) return value
  const prefix = prefixes[point]
  if (!prefix) return value
  return prefix + value.slice(point > 0xffff ? 2 : 1)
}

export function monoToolText(value: string, mono: boolean): string {
  const result = monoPrefix(value, mono)
  if (!mono) return result
  const separator = ` ${String.fromCodePoint(0xb7)} `
  const index = result.lastIndexOf(separator)
  if (index === -1) return result
  const head = result.slice(0, index)
  if (!head.includes(" completed") && head !== "patch" && !/^\d+ questions$/.test(head)) return result
  return result.slice(0, index) + " - " + result.slice(index + separator.length)
}

export function monoShortcut(value: string, mono: boolean): string {
  if (!mono) return value
  return value
    .replaceAll(String.fromCodePoint(0x2192), "right")
    .replaceAll(String.fromCodePoint(0x2190), "left")
    .replaceAll(String.fromCodePoint(0x2191), "up")
    .replaceAll(String.fromCodePoint(0x2193), "down")
}

export function monoTruncate(value: string, width: number, mono: boolean): string {
  if (!mono || value.length <= width) return value
  if (width <= 3) return ".".repeat(Math.max(0, width))
  return value.slice(0, width - 3) + "..."
}

export function monoTruncateMiddle(value: string, width: number, mono: boolean): string {
  if (!mono || value.length <= width) return value
  if (width <= 3) return ".".repeat(Math.max(0, width))
  const available = width - 3
  const left = Math.ceil(available / 2)
  return value.slice(0, left) + "..." + value.slice(value.length - (available - left))
}
