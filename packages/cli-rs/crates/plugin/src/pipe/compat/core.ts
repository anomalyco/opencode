// What a V2 plugin imports from `@opentui/core` that the JS host can give without a renderer: colors and text
// attributes. The package's other exports are inert (`inert.ts`): a plugin that imports a renderable class loads, and
// the class does nothing.

import { filetypes } from "./opentui.gen"

export const TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7,
}

// OpenTUI's color: channels from 0 to 1. `token` is the theme path the host restyles by, when the color is the
// theme's.
// OpenTUI's mouse buttons; a click the host reports is the left one.
export const MouseButton = { LEFT: 0, MIDDLE: 1, RIGHT: 2, WHEEL_UP: 4, WHEEL_DOWN: 5 } as const

export class RGBA {
  constructor(
    public r: number,
    public g: number,
    public b: number,
    public a: number,
    public token?: string,
  ) {}

  static fromValues(r: number, g: number, b: number, a = 1) {
    return new RGBA(r, g, b, a)
  }

  static fromInts(r: number, g: number, b: number, a = 255) {
    return new RGBA(r / 255, g / 255, b / 255, a / 255)
  }

  static fromHex(hex: string) {
    return hexToRgb(hex)
  }

  toInts(): [number, number, number, number] {
    return [this.r, this.g, this.b, this.a].map((value) => Math.round(value * 255)) as [number, number, number, number]
  }

  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`
  }

  equals(other?: RGBA) {
    return !!other && this.toInts().every((value, index) => value === other.toInts()[index])
  }
}

export function hexToRgb(hex: string) {
  const text = hex.replace(/^#/, "")
  const full = text.length === 3 || text.length === 4 ? [...text].map((char) => char + char).join("") : text
  const channel = (index: number) => parseInt(full.slice(index, index + 2), 16)
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return RGBA.fromValues(1, 0, 1, 1)
  return RGBA.fromInts(channel(0), channel(2), channel(4), full.length === 8 ? channel(6) : 255)
}

export function rgbToHex(color: RGBA) {
  return "#" + color.toInts().slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")
}

export function parseColor(value: string | RGBA) {
  if (value instanceof RGBA) return value
  if (value === "transparent") return RGBA.fromValues(0, 0, 0, 0)
  return value.startsWith("#") ? hexToRgb(value) : RGBA.fromValues(1, 1, 1, 1)
}

export function createTextAttributes(style: Record<string, boolean | undefined> = {}) {
  return (
    (style.bold ? TextAttributes.BOLD : 0) |
    (style.italic ? TextAttributes.ITALIC : 0) |
    (style.underline ? TextAttributes.UNDERLINE : 0) |
    (style.dim ? TextAttributes.DIM : 0) |
    (style.blink ? TextAttributes.BLINK : 0) |
    (style.inverse || style.reverse ? TextAttributes.INVERSE : 0) |
    (style.hidden ? TextAttributes.HIDDEN : 0) |
    (style.strikethrough ? TextAttributes.STRIKETHROUGH : 0)
  )
}

// Retain the styled-text brand so text nodes read the chunks rather than stringify the object.
const BrandedStyledText = Symbol.for("@opentui/core/StyledText")

export interface TextChunk {
  __isChunk: true
  text: string
  fg?: RGBA
  bg?: RGBA
  attributes?: number
  link?: { url: string }
}

type Stylable = string | number | boolean | TextChunk

export class StyledText {
  [BrandedStyledText] = true
  constructor(public chunks: TextChunk[]) {}
}

export function isStyledText(value: unknown): value is StyledText {
  return !!value && typeof value === "object" && BrandedStyledText in value
}

export function stringToStyledText(content: string) {
  return new StyledText([{ __isChunk: true, text: content }])
}

function applyStyle(input: Stylable, style: Record<string, unknown>): TextChunk {
  const own = createTextAttributes(style as Record<string, boolean | undefined>)
  const color = (value: unknown) => (value ? parseColor(value as string | RGBA) : undefined)
  if (typeof input === "object" && "__isChunk" in input)
    return {
      __isChunk: true,
      text: input.text,
      fg: color(style.fg) ?? input.fg,
      bg: color(style.bg) ?? input.bg,
      attributes: (input.attributes ?? 0) | own,
      link: input.link,
    }
  return { __isChunk: true, text: String(input), fg: color(style.fg), bg: color(style.bg), attributes: own }
}

const styled = (style: Record<string, unknown>) => (input: Stylable) => applyStyle(input, style)
export const bold = styled({ bold: true })
export const italic = styled({ italic: true })
export const underline = styled({ underline: true })
export const strikethrough = styled({ strikethrough: true })
export const dim = styled({ dim: true })
export const reverse = styled({ reverse: true })
export const blink = styled({ blink: true })
export const fg = (color: string | RGBA) => styled({ fg: color })
export const bg = (color: string | RGBA) => styled({ bg: color })
export const link = (url: string) => (input: Stylable) => ({
  ...(typeof input === "object" && "__isChunk" in input ? input : { __isChunk: true as const, text: String(input) }),
  link: { url },
})

export function t(strings: TemplateStringsArray, ...values: Stylable[]) {
  const chunks: TextChunk[] = []
  strings.forEach((raw, index) => {
    if (raw) chunks.push({ __isChunk: true, text: raw, attributes: 0 })
    const value = values[index]
    if (typeof value === "object" && "__isChunk" in value) chunks.push(value)
    else if (value !== undefined) chunks.push({ __isChunk: true, text: String(value), attributes: 0 })
  })
  return new StyledText(chunks)
}

// Use the OpenTUI filetype maps so fence registration and lookup agree.
export const extensionToFiletype = new Map<string, string>(filetypes.extensions as Array<[string, string]>)
export const basenameToFiletype = new Map<string, string>(filetypes.basenames as Array<[string, string]>)

function normalizeFiletypeToken(value: string) {
  return value.trim().replace(/^\./, "").toLowerCase() || undefined
}

function basenameOf(value: string) {
  const text = value.trim().replaceAll("\\", "/")
  if (!text) return undefined
  return text.replace(/\/+$/, "").split("/").at(-1)?.toLowerCase() || undefined
}

export function extToFiletype(extension: string) {
  const token = normalizeFiletypeToken(extension)
  return token ? extensionToFiletype.get(token) : undefined
}

export function pathToFiletype(path: string) {
  if (typeof path !== "string") return undefined
  const basename = basenameOf(path)
  if (!basename) return undefined
  const known = basenameToFiletype.get(basename)
  if (known) return known
  const dot = basename.lastIndexOf(".")
  if (dot === -1 || dot === basename.length - 1) return undefined
  return extToFiletype(basename.substring(dot + 1))
}

export function infoStringToFiletype(info: string) {
  if (typeof info !== "string") return undefined
  const token = info.trim().split(/\s+/, 1)[0] ?? ""
  const direct = basenameToFiletype.get(token.toLowerCase())
  if (direct) return direct
  const normalized = normalizeFiletypeToken(token)
  if (!normalized) return undefined
  return basenameToFiletype.get(normalized) ?? pathToFiletype(normalized) ?? extToFiletype(normalized) ?? normalized
}
