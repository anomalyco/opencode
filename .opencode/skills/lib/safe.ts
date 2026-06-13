// Shared safety helpers for opencode skills. One implementation, reused by every skill (DRY), so the
// SSRF / path-traversal / "remote-as-a-data-source" failure modes from the skills audit cannot recur.

import path from "node:path"

export class SkillSafetyError extends Error {}

// Reject remote sources for data. Skills must not fetch facts/figures from arbitrary URLs: that is
// both an SSRF surface and a "hallucinated/untrusted data presented as fact" risk. Data must come
// from local, caller-provided files. `file://` is allowed.
export function assertLocalSource(value: string) {
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme && scheme[1].toLowerCase() !== "file")
    throw new SkillSafetyError(`remote source not allowed: ${value} (skills read local, caller-provided files only)`)
  return value
}

// Resolve `candidate` under `baseDir` and guarantee it cannot escape it (anti path-traversal for any
// file a skill writes from caller-controlled input).
export function resolveInside(baseDir: string, candidate: string) {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, candidate)
  const relative = path.relative(base, resolved)
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new SkillSafetyError(`path escapes ${base}: ${candidate}`)
  return resolved
}
