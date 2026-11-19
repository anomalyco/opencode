export * as Wildcard from "./wildcard.js"

import { Wildcard } from "@opencode/schema/wildcard"

/** Windows always matches without case; `ignoreCase` extends that to other callers, such as file rules on macOS. */
export function match(input: string, pattern: string, ignoreCase = false) {
  return Wildcard.match(input, pattern, process.platform === "win32" || ignoreCase)
}
