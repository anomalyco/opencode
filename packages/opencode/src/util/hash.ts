import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    return createHash("xxhash3-xxh64").update(input).digest("hex")
  }
}
