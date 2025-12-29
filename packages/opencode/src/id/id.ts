import z from "zod"
import { randomBytes } from "crypto"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    user: "usr",
    part: "prt",
    pty: "pty",
  } as const

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  // Total ID length after prefix: 6 bytes hex (12 chars) + 14 random chars = 26 chars
  // Note: 6-byte format truncates high byte but maintains backwards compatibility
  // Use createLike() with a 7-byte reference ID when inserting at past timestamps
  const LENGTH = 26
  const TIME_BYTES = 6

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

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

  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    // Encode timestamp * 0x1000 + counter into 6 bytes (48 bits)
    // Note: This truncates the high byte for modern timestamps, but all IDs
    // created at "now" will have the same truncation, so they sort correctly.
    // The truncation only matters when inserting at past timestamps (use createLike for that).
    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((now >> BigInt((TIME_BYTES - 1 - i) * 8)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - TIME_BYTES * 2)
  }

  /**
   * Detect the byte format (6 or 7) of an existing ID.
   * 6-byte IDs: 12 hex chars + 14 random = 26 total after prefix
   * 7-byte IDs: 14 hex chars + 12 random = 26 total after prefix
   */
  export function detectFormat(id: string): 6 | 7 {
    const underscoreIndex = id.indexOf("_")
    if (underscoreIndex === -1) return TIME_BYTES as 6 | 7

    const afterPrefix = id.slice(underscoreIndex + 1)

    // Check if first 14 chars are all valid hex (would indicate 7-byte format)
    const first14 = afterPrefix.slice(0, 14)
    const isValidHex14 = /^[0-9a-f]{14}$/i.test(first14)

    if (isValidHex14) {
      // Could be 7-byte format, verify by checking if it decodes to a valid timestamp
      try {
        const bigValue = BigInt("0x" + first14)
        const ts = Number(bigValue / BigInt(0x1000))

        // Check if this looks like a valid modern timestamp (after 2020, before 2100)
        const year2020 = 1577836800000
        const year2100 = 4102444800000
        if (ts >= year2020 && ts < year2100) {
          return 7
        }
      } catch {
        // Not valid hex, fall through to 6-byte
      }
    }

    // Otherwise assume 6-byte (old format)
    return 6
  }

  /**
   * Create an ID that sorts immediately after a reference ID.
   *
   * This works by extracting the raw encoded value from the reference ID and
   * incrementing it, ensuring the new ID sorts correctly regardless of the
   * byte format (6 or 7 bytes).
   *
   * @param referenceId - The ID to sort after
   * @param prefix - The prefix for the new ID (e.g., "message", "part")
   * @param descending - Whether to use descending order (usually false)
   * @param offsetMs - Milliseconds to add to the reference timestamp (default 1)
   */
  export function createLike(
    referenceId: string,
    prefix: keyof typeof prefixes,
    descending: boolean,
    offsetMs: number = 1,
  ): string {
    const format = detectFormat(referenceId)
    const underscoreIndex = referenceId.indexOf("_")
    if (underscoreIndex === -1) {
      throw new Error(`Invalid reference ID: ${referenceId}`)
    }

    // Extract the hex timestamp portion from the reference ID
    const hexPart = referenceId.slice(underscoreIndex + 1, underscoreIndex + 1 + format * 2)
    const referenceValue = BigInt("0x" + hexPart)

    // Add offset (in the encoded space: offsetMs * 0x1000)
    // This ensures the new ID sorts after the reference regardless of truncation
    let newValue = referenceValue + BigInt(offsetMs) * BigInt(0x1000) + BigInt(1) // +1 for counter

    newValue = descending ? ~newValue : newValue

    const timeBytes = Buffer.alloc(format)
    for (let i = 0; i < format; i++) {
      timeBytes[i] = Number((newValue >> BigInt((format - 1 - i) * 8)) & BigInt(0xff))
    }

    const randomLength = LENGTH - format * 2
    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(randomLength)
  }

  /**
   * Decode the timestamp from an ID.
   * Handles both old 6-byte IDs and new 7-byte IDs.
   */
  export function decodeTimestamp(id: string): { timestamp: number; counter: number } | null {
    const underscoreIndex = id.indexOf("_")
    if (underscoreIndex === -1) return null

    const hexPart = id.slice(underscoreIndex + 1)

    // Determine if this is an old 6-byte ID or new 7-byte ID
    // Old IDs: 12 hex chars for time + 14 random = 26 total after prefix
    // New IDs: 14 hex chars for time + 12 random = 26 total after prefix
    // We can detect by checking if the first 14 chars decode to a reasonable timestamp

    // Try 7-byte (new format) first
    if (hexPart.length >= 14) {
      const hex7 = hexPart.slice(0, 14)
      const bigValue7 = BigInt("0x" + hex7)
      const ts7 = Number(bigValue7 / BigInt(0x1000))
      const counter7 = Number(bigValue7 % BigInt(0x1000))

      // Check if this looks like a valid modern timestamp (after 2020, before 2100)
      const year2020 = 1577836800000
      const year2100 = 4102444800000
      if (ts7 >= year2020 && ts7 < year2100) {
        return { timestamp: ts7, counter: counter7 }
      }
    }

    // Try 6-byte (old format)
    if (hexPart.length >= 12) {
      const hex6 = hexPart.slice(0, 12)
      const bigValue6 = BigInt("0x" + hex6)
      const ts6 = Number(bigValue6 / BigInt(0x1000))
      const counter6 = Number(bigValue6 % BigInt(0x1000))
      return { timestamp: ts6, counter: counter6 }
    }

    return null
  }
}
