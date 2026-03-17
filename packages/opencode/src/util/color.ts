/**
 * Color utility namespace for hex color manipulation.
 *
 * Provides functions for validating hex colors, converting to RGB,
 * and generating ANSI escape codes for terminal output.
 *
 * @example
 * ```typescript
 * const isValid = Color.isValidHex("#ff5733")
 * const rgb = Color.hexToRgb("#ff5733")
 * const ansi = Color.hexToAnsiBold("#ff5733")
 * ```
 */
export namespace Color {
  /**
   * Validates if a string is a valid hex color code.
   *
   * @param hex - The hex color string to validate (e.g., "#ff5733")
   * @returns True if valid hex color, false otherwise
   */
  export function isValidHex(hex?: string): hex is string {
    if (!hex) return false
    return /^#[0-9a-fA-F]{6}$/.test(hex)
  }

  /**
   * Converts a hex color string to RGB values.
   *
   * @param hex - The hex color string (e.g., "#ff5733")
   * @returns Object with r, g, b values (0-255)
   */
  export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return { r, g, b }
  }

  /**
   * Converts a hex color to an ANSI bold escape sequence.
   *
   * @param hex - The hex color string (e.g., "#ff5733")
   * @returns ANSI escape sequence string, or undefined if invalid hex
   */
  export function hexToAnsiBold(hex?: string): string | undefined {
    if (!isValidHex(hex)) return undefined
    const { r, g, b } = hexToRgb(hex)
    return `\x1b[38;2;${r};${g};${b}m\x1b[1m`
  }
}
