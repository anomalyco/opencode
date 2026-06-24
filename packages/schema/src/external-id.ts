import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"

export interface ExternalID {
  readonly namespace: string
  readonly key: string
}

export const externalID = (prefix: string, input: ExternalID) =>
  `${prefix}_${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([input.namespace, input.key]))))}`
