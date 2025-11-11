import { encode as toonEncode, type EncodeOptions } from "@toon-format/toon"

/**
 * TOON utilities for token-efficient data encoding for LLM contexts.
 *
 * TOON (Token-Oriented Object Notation) is a compact format designed for
 * LLM input that reduces token usage by 30-60% compared to JSON for
 * uniform arrays of objects.
 *
 * Note: TOON is encoding-only - it's designed for LLM input, not round-trip
 * serialization. Use JSON for storage and convert to TOON for AI contexts.
 */

export type { EncodeOptions }

/**
 * Encode data to TOON format for efficient LLM input.
 */
export function encode(data: unknown, options?: EncodeOptions): string {
  return toonEncode(data, options)
}

/**
 * Optimize data for AI context using TOON encoding with recommended settings.
 */
export function optimizeForAI(data: unknown): string {
  return encode(data, {
    indent: 2,
    delimiter: ",",
  })
}

/**
 * Convert JSON string to TOON format.
 */
export function convertFromJSON(json: string): string {
  const data = JSON.parse(json)
  return encode(data)
}

/**
 * Format data as TOON if enabled in config, otherwise use provided fallback formatter.
 *
 * @param data - The data to format
 * @param formatPlain - Function to format data as plain text (fallback)
 * @param enabled - Whether TOON encoding is enabled
 * @returns Formatted output string
 *
 * @example
 * const output = conditionalEncode(
 *   [{path: "a.ts", line: 10}],
 *   (data) => data.map(d => `${d.path}:${d.line}`).join("\n"),
 *   config.ai?.useToonEncoding
 * )
 */
export function conditionalEncode(data: unknown, formatPlain: (data: unknown) => string, enabled?: boolean): string {
  if (enabled) {
    return optimizeForAI(data)
  }
  return formatPlain(data)
}
