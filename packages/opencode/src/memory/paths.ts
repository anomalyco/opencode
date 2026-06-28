import path from "path"
import { createHash } from "crypto"

export type Scope = "global" | "projects" | "sessions"
export type MemoryType = "free" | "memory" | "checkpoint" | "progress" | "notes"

export interface MemoryLocator {
  scope: Scope
  scope_id: string
  type: MemoryType
  key: string
}

const TYPE_PATTERNS: Array<{ match: RegExp; type: MemoryType }> = [
  // Only `memory` is case-insensitive: it's the one file renamed lowercase
  // memory.md -> MEMORY.md, so detection must bridge both casings.
  { match: /^memory$/i, type: "memory" },
  { match: /^memory-/i, type: "memory" },
  { match: /^checkpoint$/, type: "checkpoint" },
  { match: /^checkpoint-/, type: "checkpoint" },
  { match: /^tasks\/[^/]+\/progress$/, type: "progress" },
  { match: /^tasks\/[^/]+\/notes$/, type: "notes" },
]

function detectType(key: string): MemoryType {
  for (const p of TYPE_PATTERNS) if (p.match.test(key)) return p.type
  return "free"
}

/**
 * Parse an absolute memory file path into its locator. The path is expected to
 * use forward slashes (normalize on Windows before calling).
 * Layout: <data>/memory/<global|projects|sessions>/<scope_id?>/<key>.md
 */
export function parsePath(absPath: string): MemoryLocator | null {
  const m = absPath.match(/\/memory\/(global|projects|sessions)(?:\/([^/]+))?\/(.+)\.md$/)
  if (!m) return null
  const [, scope, idMaybe, keyRaw] = m
  const scope_id = scope === "global" ? "" : (idMaybe ?? "")
  const key = keyRaw
  return { scope: scope as Scope, scope_id, type: detectType(key), key }
}

function assertSafeComponent(value: string) {
  for (const segment of value.split("/")) {
    if (segment === "..") throw new Error(`buildPath: invalid path component: ${value}`)
  }
  if (value.startsWith("/")) throw new Error(`buildPath: invalid path component: ${value}`)
}

export function buildPath(input: { root: string; scope: Scope; scope_id?: string; key: string }): string {
  if (input.scope_id !== undefined) assertSafeComponent(input.scope_id)
  assertSafeComponent(input.key)
  const parts = [input.root, input.scope]
  if (input.scope !== "global") parts.push(input.scope_id ?? "")
  parts.push(`${input.key}.md`)
  return path.join(...parts)
}

export function resolveProjectId(absRepoPath: string): string {
  return createHash("sha256").update(absRepoPath).digest("hex").slice(0, 12)
}
