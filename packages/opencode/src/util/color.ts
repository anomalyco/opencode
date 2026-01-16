export namespace Color {
  export function isValidHex(hex?: string): hex is string {
    if (!hex) return false
    return /^#[0-9a-fA-F]{6}$/.test(hex)
  }

  export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
    const color = hex.replace("#", "")
    const hasAlpha = color.length === 4 || color.length === 8

    const expanded =
      color.length <= 4
        ? color
            .split("")
            .map((c) => c + c)
            .join("")
        : color

    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    const a = hasAlpha ? parseInt(expanded.slice(6, 8), 16) / 255 : 1

    return { r, g, b, a }
  }

  export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const { r, g, b } = hexToRgba(hex)
    return { r, g, b }
  }

  export function blend(
    fg: { r: number; g: number; b: number; a: number },
    bg: { r: number; g: number; b: number },
  ): { r: number; g: number; b: number } {
    return {
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    }
  }

  export function hexToAnsiBold(hex?: string): string | undefined {
    if (!isValidHex(hex)) return undefined
    const { r, g, b } = hexToRgb(hex)
    return `\x1b[38;2;${r};${g};${b}m\x1b[1m`
  }

  export function getContrastColor(color: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
    const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255
    return luminance > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
  }
}
