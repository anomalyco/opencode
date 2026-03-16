/**
 * Utility functions for color manipulation and conversion.
 *
 * This namespace provides helpers for working with hex color codes,
 * including validation, RGB conversion, and ANSI escape code generation
 * for terminal output.
 */
export namespace Color {
  /**
   * Validates if a string is a valid hex color code.
   *
   * Checks if the string matches the format #RRGGBB where R, G, B
   * are hexadecimal digits (0-9, a-f, A-F).
   *
   * @param hex - The hex color string to validate
   * @returns True if the hex string is valid, false otherwise
   * @example
   * ```typescript
   * Color.isValidHex("#FF5733") // Returns: true
   * Color.isValidHex("#GGGGGG") // Returns: false
   * Color.isValidHex(undefined) // Returns: false
   * ```
   */
  export function isValidHex(hex?: string): hex is string {
    if (!hex) return false
    return /^#[0-9a-fA-F]{6}$/.test(hex)
  }

  /**
   * Converts a hex color code to RGB values.
   *
   * Parses the hex string and extracts the red, green, and blue
   * components as numbers (0-255).
   *
   * @param hex - The hex color code (e.g., "#FF5733")
   * @returns An object with r, g, b properties representing RGB values
   * @throws May throw if hex format is invalid (use isValidHex first)
   * @example
   * ```typescript
   * Color.hexToRgb("#FF5733") // Returns: { r: 255, g: 87, b: 51 }
   * ```
   */
  export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return { r, g, b }
  }

  /**
   * Converts a hex color to ANSI escape code for bold colored terminal text.
   *
   * Generates an ANSI escape sequence that sets both the foreground color
   * and bold text style. Returns undefined if the hex code is invalid.
   *
   * @param hex - The hex color code (optional)
   * @returns ANSI escape code string or undefined if invalid
   * @example
   * ```typescript
   * const ansi = Color.hexToAnsiBold("#FF5733")
   * console.log(`${ansi}Hello World\x1b[0m`)
   * // Outputs bold colored "Hello World" in terminal
   * ```
   */
  export function hexToAnsiBold(hex?: string): string | undefined {
    if (!isValidHex(hex)) return undefined
    const { r, g, b } = hexToRgb(hex)
    return `\x1b[38;2;${r};${g};${b}m\x1b[1m`
  }
}
