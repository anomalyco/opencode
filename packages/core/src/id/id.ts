import { create as createIdentifier } from "@opencode-ai/schema/identifier"

const prefixes = {
  job: "job",
  event: "evt",
  session: "ses",
  message: "msg",
  permission: "per",
  question: "que",
  part: "prt",
  pty: "pty",
  tool: "tool",
  workspace: "wrk",
} as const

export function ascending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, "ascending", given)
}

export function descending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, "descending", given)
}

function generateID(prefix: keyof typeof prefixes, direction: "descending" | "ascending", given?: string): string {
  if (!given) {
    return create(prefixes[prefix], direction)
  }

  if (!given.startsWith(prefixes[prefix])) {
    throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
  }
  return given
}

export function create(prefix: string, direction: "descending" | "ascending", timestamp?: number): string {
  return prefix + "_" + createIdentifier(direction === "descending", timestamp)
}

/** Extract timestamp from an ascending ID. Does not work with descending IDs. */
export function timestamp(id: string): number {
  const prefix = id.split("_")[0]
  const suffixLength = id.length - prefix.length - 1
  const hexLength = suffixLength > 26 ? 16 : 12
  const hex = id.slice(prefix.length + 1, prefix.length + 1 + hexLength)
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error(`ID ${id} does not contain an encoded timestamp`)
  const encoded = BigInt("0x" + hex)
  return Number(encoded >> 12n)
}

export * as Identifier from "./id"
