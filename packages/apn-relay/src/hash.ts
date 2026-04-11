import { createHash } from "node:crypto"

export function hash(input: string) {
  return createHash("sha256").update(input).digest("hex")
}
