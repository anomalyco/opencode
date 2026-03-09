import z from "zod"
import { randomBytes } from "crypto"

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

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

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

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((now >> BigInt((TIME_BYTES - 1 - i) * 8)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - TIME_BYTES * 2)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }

  /**
   * Insert an ID that sorts after afterId, and optionally before beforeId.
   *
   * If beforeId is provided and there's a gap, the new ID will sort between them.
   * Otherwise, the new ID will sort immediately after afterId.
   *
   * @param afterId - The ID that the new ID must sort AFTER
   * @param beforeId - Optional ID that the new ID should sort BEFORE (if gap exists)
   * @param prefix - The prefix for the new ID (e.g., "message", "part")
   */
  export function insert(afterId: string, beforeId: string | undefined, prefix: keyof typeof prefixes): string {
    const underscoreIndex = afterId.indexOf("_")
    if (underscoreIndex === -1) {
      throw new Error(`Invalid afterId: ${afterId}`)
    }

    const afterHex = afterId.slice(underscoreIndex + 1, underscoreIndex + 1 + TIME_BYTES * 2)
    const afterValue = BigInt("0x" + afterHex)

    let newValue: bigint

    if (beforeId) {
      const beforeUnderscoreIndex = beforeId.indexOf("_")
      if (beforeUnderscoreIndex !== -1) {
        const beforeHex = beforeId.slice(beforeUnderscoreIndex + 1, beforeUnderscoreIndex + 1 + TIME_BYTES * 2)
        if (/^[0-9a-f]+$/i.test(beforeHex)) {
          const beforeValue = BigInt("0x" + beforeHex)
          const gap = beforeValue - afterValue
          if (gap > BigInt(1)) {
            // Insert in the middle of the gap
            newValue = afterValue + gap / BigInt(2)
          } else {
            // Gap too small, create after afterId
            newValue = afterValue + BigInt(0x1000) + BigInt(1)
          }
        } else {
          newValue = afterValue + BigInt(0x1000) + BigInt(1)
        }
      } else {
        newValue = afterValue + BigInt(0x1000) + BigInt(1)
      }
    } else {
      // No beforeId, create after afterId
      newValue = afterValue + BigInt(0x1000) + BigInt(1)
    }

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((newValue >> BigInt((TIME_BYTES - 1 - i) * 8)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - TIME_BYTES * 2)
  }

  /**
   * Generate a pair of IDs (message + part) that both sort between afterId and beforeId.
   * Used when copying a user message mid-chain: the message ID sorts between the two
   * anchors, and the part ID sorts just after the message ID.
   *
   * @param afterId - The ID that the new IDs must sort AFTER
   * @param beforeId - Optional ID that the new IDs should sort BEFORE
   */
  export function insertCopy(afterId: string, beforeId: string | undefined): { messageID: string; partID: string } {
    const messageID = insert(afterId, beforeId, "message")
    // Part ID sorts just after the message ID, still before beforeId
    const partID = insert(messageID, beforeId, "part")
    return { messageID, partID }
  }
}
