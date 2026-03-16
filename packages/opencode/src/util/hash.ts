import { createHash } from "crypto"

/**
 * Provides fast hashing utilities using SHA1.
 *
 * This namespace offers a simple interface for generating SHA1 hashes
 * from strings or Buffer data. Useful for creating quick content
 * fingerprints, checksums, or cache keys.
 *
 * @example
 * ```typescript
 * const hash = Hash.fast("hello world")
 * // Returns: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed"
 * ```
 */
export namespace Hash {
  /**
   * Generates a SHA1 hash of the input string or Buffer.
   *
   * Uses Node.js crypto module to create a SHA1 hash and returns
   * the hexadecimal digest. Suitable for non-cryptographic purposes
   * like content identification or deduplication.
   *
   * @param input - The string or Buffer to hash
   * @returns The SHA1 hash as a hexadecimal string
   */
  export function fast(input: string | Buffer): string {
    return createHash("sha1").update(input).digest("hex")
  }
}
