import z from "zod"
import { randomBytes } from "crypto"

/**
 * Utility namespace for generating and validating unique identifiers.
 *
 * Provides functions for creating time-sortable unique IDs with various prefixes
 * for different entity types (sessions, messages, users, etc.). Supports both
 * ascending and descending sort orders for different use cases.
 *
 * @example
 * ```typescript
 * const sessionId = Identifier.create("session", false)
 * const messageId = Identifier.ascending("message")
 * const timestamp = Identifier.timestamp(sessionId)
 * ```
 */
export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
    workspace: "wrk",
  } as const

  /**
   * Creates a Zod schema for validating IDs with a specific prefix.
   *
   * @param prefix - The entity type prefix to validate against
   * @returns A Zod string schema that validates IDs starting with the given prefix
   */
  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  /**
   * Generates or validates an ascending (chronological) ID.
   *
   * If a specific ID is provided, validates it has the correct prefix and returns it.
   * Otherwise, generates a new ascending ID that sorts chronologically.
   *
   * @param prefix - The entity type prefix for the ID
   * @param given - Optional existing ID to validate instead of generating a new one
   * @returns A valid ascending ID string
   * @throws Error if the given ID has an incorrect prefix
   */
  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  /**
   * Generates or validates a descending (reverse chronological) ID.
   *
   * If a specific ID is provided, validates it has the correct prefix and returns it.
   * Otherwise, generates a new descending ID that sorts in reverse chronological order.
   * Useful for retrieving items with newest first.
   *
   * @param prefix - The entity type prefix for the ID
   * @param given - Optional existing ID to validate instead of generating a new one
   * @returns A valid descending ID string
   * @throws Error if the given ID has an incorrect prefix
   */
  export function descending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
    if (!given) {
      return create(prefix, descending)
    }

    if (!given.startsWith(prefixes[prefix])) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }
    return given
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""
    const bytes = randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % 62]
    }
    return result
  }

  /**
   * Creates a new unique ID with the specified prefix and sort order.
   *
   * Generates a time-based ID using the current timestamp and a monotonic counter
   * to ensure uniqueness. The ID format includes a prefix, timestamp (encoded),
   * and random base62 characters.
   *
   * @param prefix - The entity type prefix for the ID
   * @param descending - Whether to generate a descending (reverse chronological) ID
   * @param timestamp - Optional custom timestamp (defaults to Date.now())
   * @returns A unique ID string with the format "prefix_hexTimestamp_random"
   */
  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }
}
