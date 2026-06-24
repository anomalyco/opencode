export const AttrMask = {
  NONE:      0,
  BOLD:      1 << 0,
  ITALIC:    1 << 1,
  UNDERLINE: 1 << 2,
  STRIKE:    1 << 3,
  INVERSE:   1 << 4,
  HIDDEN:    1 << 5,
} as const

export type AttrMask = (typeof AttrMask)[keyof typeof AttrMask]

export interface CellAttributes {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  inverse: boolean
  hidden: boolean
}

/**
 * 0 = terminal default color
 * 1-255 = 256-color palette
 */
export interface CellData {
  cp: number
  fg: number
  bg: number
  attr: number
}

export function encodeAttrs(attrs: CellAttributes): number {
  let mask = 0
  if (attrs.bold) mask |= AttrMask.BOLD
  if (attrs.italic) mask |= AttrMask.ITALIC
  if (attrs.underline) mask |= AttrMask.UNDERLINE
  if (attrs.strikethrough) mask |= AttrMask.STRIKE
  if (attrs.inverse) mask |= AttrMask.INVERSE
  if (attrs.hidden) mask |= AttrMask.HIDDEN
  return mask
}

export function decodeAttrs(mask: number): CellAttributes {
  return {
    bold:          (mask & AttrMask.BOLD)      !== 0,
    italic:        (mask & AttrMask.ITALIC)    !== 0,
    underline:     (mask & AttrMask.UNDERLINE) !== 0,
    strikethrough: (mask & AttrMask.STRIKE)    !== 0,
    inverse:       (mask & AttrMask.INVERSE)   !== 0,
    hidden:        (mask & AttrMask.HIDDEN)    !== 0,
  }
}
