import z from "zod"
import { randomBytes } from "crypto"
import type { SessionID, MessageID, PermissionID, UserID, PartID } from "../util/branded-types"

// Re-export branded types for convenient access
export type { SessionID, MessageID, PermissionID, UserID, PartID } from "../util/branded-types"
export {
  asSessionID,
  asMessageID,
  asPermissionID,
  asUserID,
  asPartID,
  asProjectID,
  asToolCallID,
  unwrapID,
  isSameID,
} from "../util/branded-types"
export type { ProjectID, ToolCallID, Brand } from "../util/branded-types"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    user: "usr",
    part: "prt",
  } as const

  // Map prefix keys to their branded types
  type PrefixToBrandedType = {
    session: SessionID
    message: MessageID
    permission: PermissionID
    user: UserID
    part: PartID
  }

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  /**
   * Generate an ascending (time-ordered) ID for the given prefix
   * Returns a branded type for compile-time type safety
   */
  export function ascending<P extends keyof typeof prefixes>(
    prefix: P,
    given?: string,
  ): PrefixToBrandedType[P] {
    return generateID(prefix, false, given) as PrefixToBrandedType[P]
  }

  /**
   * Generate a descending (reverse time-ordered) ID for the given prefix
   * Returns a branded type for compile-time type safety
   */
  export function descending<P extends keyof typeof prefixes>(
    prefix: P,
    given?: string,
  ): PrefixToBrandedType[P] {
    return generateID(prefix, true, given) as PrefixToBrandedType[P]
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

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }
}
