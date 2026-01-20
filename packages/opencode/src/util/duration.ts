import ms from "ms"
import z from "zod"

/**
 * Zod schema for duration strings (e.g., '30m', '1h', '7d').
 * Validates that the string is a valid duration format.
 * The string is stored as-is (not transformed to milliseconds).
 */
export const Duration = z
  .string()
  .refine((val) => ms(val as ms.StringValue) !== undefined, {
    message: "Invalid duration format. Use formats like '30m', '1h', '7d'",
  })
  .describe("Duration string (e.g., '30m', '1h', '7d')")
  .meta({ ref: "DurationString" })

export type Duration = z.infer<typeof Duration>

/**
 * Parse a duration string to milliseconds.
 *
 * @param str - Duration string like '30m', '1h', '7d'
 * @returns Milliseconds, or undefined if invalid format
 *
 * @example
 * parseDuration('30m') // 1800000
 * parseDuration('1h')  // 3600000
 * parseDuration('7d')  // 604800000
 * parseDuration('invalid') // undefined
 */
export function parseDuration(str: string): number | undefined {
  return ms(str as ms.StringValue)
}
