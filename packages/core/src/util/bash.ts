export * as Bash from "./bash"

import { parse } from "unbash"
import type { Word } from "unbash"

/**
 * Filesystem paths a bash command references, dequoted and unescaped. Every parsed word is a
 * candidate because the shell expands them all; callers filter with `path.isAbsolute`, which
 * already discards descriptors (`2>&1`), heredoc delimiters and unexpanded parameters.
 */
export function pathWords(command: string) {
  return [...walk(parse(command))]
}

/**
 * unbash resolves these lazily, as prototype accessors rather than own properties, so walking
 * `Object.entries` alone silently skips every path nested under them.
 */
const LAZY = ["parts", "expression", "initialize", "test", "update"]

function* walk(node: unknown): Generator<string> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item)
    return
  }
  if (!node || typeof node !== "object") return
  if (isWord(node)) yield node.value
  const fields = node as Record<string, unknown>
  for (const [key, child] of Object.entries(fields)) {
    // A heredoc body is data rather than a path, though its expansions still run.
    if (key === "body" && typeof fields.operator === "string" && isWord(child)) {
      yield* walk(child.parts)
      continue
    }
    yield* walk(child)
  }
  for (const key of LAZY) if (!Object.hasOwn(fields, key)) yield* walk(fields[key])
}

/** Words carry a source position; the expansion parts nested inside them do not. */
function isWord(node: unknown): node is Word {
  if (!node || typeof node !== "object") return false
  const fields = node as Record<string, unknown>
  return typeof fields.value === "string" && typeof fields.pos === "number"
}
