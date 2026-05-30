import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    return createHash("sha1").update(input).digest("hex")
  }

  /** The first 14 characters of the SHA1 hash are used as a short identifier to distinguish different git stores. */
  export function short(input: string): string {
    return fast(input).substring(0, 14)
  }
}
