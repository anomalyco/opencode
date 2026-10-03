// Formation guard — the security boundary of the Soul layer.
//
// "An agent may not edit its own axioms" is enforced here, in code, by the
// permission layer. It is not a prompt instruction the model can talk itself
// out of. Every agent tool call flows through Permission.ask; user edits made
// in their own editor never touch this path and are unaffected.
//
// The protected set is the soul file plus its co-located eval artifacts. The
// names are conventional and fixed so the guard stays a pure function with no
// config or I/O — there is nothing to misconfigure into an open gate.

export const SOUL_FILENAMES = ["SOUL.md", "SOUL.suite.yaml", "SOUL.baseline.json"] as const

export function isSoulFilename(name: string): boolean {
  return (SOUL_FILENAMES as readonly string[]).includes(name)
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] ?? p
}

// True when an edit request targets a soul artifact. `pattern` is the
// worktree-relative path (or glob) from the permission request; `filepath` is
// the absolute path from the tool metadata when present, which is authoritative.
export function isProtectedEditTarget(pattern: string, filepath?: unknown): boolean {
  if (typeof filepath === "string" && isSoulFilename(basename(filepath))) return true
  if (pattern.includes("*")) {
    // Glob form, e.g. **/SOUL.md. A bare "*.md" must not match.
    const deglobbed = basename(pattern.replace(/\*/g, ""))
    return deglobbed !== "" && isSoulFilename(deglobbed)
  }
  return isSoulFilename(basename(pattern))
}

// Message shown to the agent when the guard fires. It names the rule and the
// legitimate path: the human edits the file in their own editor.
export function denialMessage(target: string): string {
  return (
    `Denied by the soul formation guard: agents may never edit ${target}. ` +
    `Axioms change only by human edit plus a full eval re-run. ` +
    `Ask the user to make this change in their own editor.`
  )
}

export * as SoulGuard from "./guard"
