import { randomBytes } from "crypto"

export namespace Identifier {
  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending() {
    return create(false)
  }

  export function descending() {
    return create(true)
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    // Reject bytes in the biased tail so each character is uniformly distributed.
    // 256 % 62 == 8, so bytes >= 248 would over-represent the first 8 characters.
    const limit = 256 - (256 % chars.length)
    let result = ""
    while (result.length < length) {
      const bytes = randomBytes(length - result.length)
      for (let i = 0; i < bytes.length && result.length < length; i++) {
        const b = bytes[i]
        if (b >= limit) continue
        result += chars[b % chars.length]
      }
    }
    return result
  }

  export function create(descending: boolean, timestamp?: number): string {
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

    return timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }
}
