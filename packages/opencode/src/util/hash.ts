import { createHash } from "crypto"

/**
 * Fast hash computation namespace.
 *
 * Provides SHA1-based hashing for quick content identification.
 * Suitable for non-cryptographic use cases like cache keys or content deduplication.
 *
 * @example
 * ```typescript
 * const hash = Hash.fast("content to hash")
 * const bufferHash = Hash.fast(Buffer.from("binary data"))
 * ```
 */
export namespace Hash {
  /**
   * Computes a fast SHA1 hash of the input.
   *
   * @param input - The string or Buffer to hash
   * @returns The hexadecimal hash string
   */
  export function fast(input: string | Buffer): string {
    return createHash("sha1").update(input).digest("hex")
  }
}
