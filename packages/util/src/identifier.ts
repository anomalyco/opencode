import z from "zod"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    user: "usr",
    part: "prt",
    pty: "pty",
  } as const

  export type Prefix = keyof typeof prefixes
  type CryptoLike = {
    getRandomValues<T extends ArrayBufferView>(array: T): T
  }

  const TOTAL_LENGTH = 26
  const RANDOM_LENGTH = TOTAL_LENGTH - 12
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

  let lastTimestamp = 0
  let counter = 0

  const fillRandomBytes = (buffer: Uint8Array) => {
    const cryptoLike = (globalThis as { crypto?: CryptoLike }).crypto
    if (cryptoLike?.getRandomValues) {
      cryptoLike.getRandomValues(buffer)
      return buffer
    }
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.floor(Math.random() * 256)
    }
    return buffer
  }

  const randomBase62 = (length: number) => {
    const bytes = fillRandomBytes(new Uint8Array(length))
    let result = ""
    for (let i = 0; i < length; i++) {
      result += BASE62[bytes[i] % BASE62.length]
    }
    return result
  }

  const createSuffix = (descending: boolean, timestamp?: number) => {
    const currentTimestamp = timestamp ?? Date.now()
    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter += 1

    let value = BigInt(currentTimestamp) * 0x1000n + BigInt(counter)
    if (descending) value = ~value

    const timeBytes = new Uint8Array(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((value >> BigInt(40 - 8 * i)) & 0xffn)
    }
    const hex = Array.from(timeBytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
    return hex + randomBase62(RANDOM_LENGTH)
  }

  const generateID = (prefix: Prefix, descending: boolean, given?: string, timestamp?: number) => {
    if (given) {
      const expected = `${prefixes[prefix]}_`
      if (!given.startsWith(expected)) throw new Error(`ID ${given} does not start with ${expected}`)
      return given
    }
    return `${prefixes[prefix]}_${createSuffix(descending, timestamp)}`
  }

  export const schema = (prefix: Prefix) => z.string().startsWith(`${prefixes[prefix]}_`)

  export function ascending(): string
  export function ascending(prefix: Prefix, given?: string): string
  export function ascending(prefix?: Prefix, given?: string) {
    if (prefix) return generateID(prefix, false, given)
    return create(false)
  }

  export function descending(): string
  export function descending(prefix: Prefix, given?: string): string
  export function descending(prefix?: Prefix, given?: string) {
    if (prefix) return generateID(prefix, true, given)
    return create(true)
  }

  export function create(descending: boolean, timestamp?: number) {
    return createSuffix(descending, timestamp)
  }

  export function createPrefixed(prefix: Prefix, descending: boolean, timestamp?: number) {
    return generateID(prefix, descending, undefined, timestamp)
  }
}
