// What a V2 plugin imports from `@opentui/core` that the JS host can give without a renderer: colors and text
// attributes. A plugin that imports a renderable class or the renderer itself fails to load, and says which.

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

// The file types a fenced code block's info string names, as OpenTUI's `infoStringToFiletype` reads them.
export function infoStringToFiletype(info: string) {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase()
  return name || undefined
}
