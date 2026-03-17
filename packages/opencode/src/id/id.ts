import z from "zod"
import { randomBytes } from "crypto"

/**
 * Identifier generation and validation namespace.
 *
 * Provides type-safe ID generation with prefixes for different entity types.
 * IDs are time-sortable (KSUID-like) and include random suffixes for uniqueness.
 * Supports both ascending and descending ID generation for different sort orders.
 *
 * @example
 * ```typescript
 * const id = Identifier.create("session", false)
 * const schema = Identifier.schema("message")
 * const time = Identifier.timestamp(id)
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
   * @param prefix - The ID prefix type (e.g., "session", "message")
   * @returns Zod string schema that validates the ID format
   */
  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  /**
   * Generates or validates an ascending (time-ordered) ID.
   *
   * If given is provided, validates it matches the prefix. Otherwise,
   * creates a new ascending ID that sorts from oldest to newest.
   *
   * @param prefix - The ID prefix type
   * @param given - Optional existing ID to validate
   * @returns The validated or newly created ID
   */
  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  /**
   * Generates or validates a descending (reverse time-ordered) ID.
   *
   * If given is provided, validates it matches the prefix. Otherwise,
   * creates a new descending ID that sorts from newest to oldest.
   *
   * @param prefix - The ID prefix type
   * @param given - Optional existing ID to validate
   * @returns The validated or newly created ID
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
   * Creates a new time-sortable ID with the specified prefix.
   *
   * Generates a KSUID-like identifier combining timestamp, counter,
   * and random bytes for uniqueness.
   *
   * @param prefix - The ID prefix type (e.g., "session", "message")
   * @param descending - Whether to generate a descending (reverse) ID
   * @param timestamp - Optional timestamp override (defaults to Date.now())
   * @returns The generated ID string
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

  /**
   * Extracts the timestamp from an ascending ID.
   *
   * Note: This function only works correctly with ascending IDs.
   * Descending IDs use bitwise complement and cannot be decoded this way.
   *
   * @param id - The ID to extract timestamp from
   * @returns The timestamp in milliseconds
   */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }
}
