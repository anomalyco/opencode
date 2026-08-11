/**
 * The Opviera wordmark, split into two halves that are rendered in different shades.
 *
 * `marks` below are shading control characters, not glyphs: `_` and `~` render as blank shaded
 * cells and `^` as a shaded upper bar. Keep every row in a half the same width or the halves
 * will not line up.
 */
export const logo = {
  left: ["              ", "█▀▀█ █▀▀█ █__█", "█__█ █__█ █__█", "▀▀▀▀ █▀▀▀ ▀▄▄▀"],
  right: ["  ▄                ", "  █  █▀▀█ █▀▀▄ ▄▀▀█", "  █  █^^^ █___ █▄▄█", "  ▀  ▀▀▀▀ ▀___ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
