export * as Wildcard from "./wildcard.js"

import { Wildcard } from "@opencode/schema/wildcard"

export function match(input: string, pattern: string) {
  return Wildcard.match(input, pattern, process.platform === "win32")
}
