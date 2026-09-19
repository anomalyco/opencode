/**
 * Encoding-preserving relocation of absolute path references inside stored text.
 *
 * Field evidence (see docs/project-rename-move-reliability.md): the same logical
 * directory is persisted at several escape depths (plain, JSON-escaped once, JSON-
 * escaped twice inside nested tool payloads), with forward or backward separators,
 * with or without a drive letter. Naive substring replacement misses almost all of
 * these and risks corrupting recorded content such as source code or edit diffs.
 *
 * This rewriter instead tokenizes the old directory into components joined by
 * separator runs, matches that skeleton anywhere in a text, and splices the new
 * components in while reusing each match's own captured separator runs - correct
 * at any escape depth, and inert on unrelated content (other users' homes, sibling
 * folders like `proj-old`, relative URLs, mentions of the bare folder name).
 *
 * Regex safety: every dynamic component is fully escaped and the only quantifiers
 * are single-character-class runs (`[/\\]+`) anchored between literals, so there
 * is no alternation-of-quantifiers structure to backtrack explosively (ReDoS-safe).
 */

export interface PathRewriter {
  /** True when `text` contains at least one reference to the old location. */
  matches(text: string): boolean
  /** Rewrite every reference of the old location into the new one. */
  rewrite(text: string): string
}

interface Tokens {
  comps: string[]
  leadingSep: boolean
}

function tokenize(dir: string): Tokens {
  const trimmed = dir.replace(/[\\/]+$/, "")
  const leadingSep = /^[\\/]/.test(trimmed)
  const comps = trimmed.split(/[\\/]+/).filter((part) => part.length > 0)
  return { comps, leadingSep }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isDriveLike(comp: string | undefined): boolean {
  return !!comp && /^[A-Za-z]:$/.test(comp)
}

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Build a rewriter mapping occurrences of `oldDir` onto `newDir`.
 *
 * The two paths must share their component structure up to the point where they
 * diverge; components beyond the shared prefix are appended using the last
 * observed separator run, so both renames and moves (shallower or deeper) work.
 *
 * Throws when either path has no components or when both paths are identical
 * modulo separator/case differences - there would be nothing to relocate.
 */
export function createPathRewriter(oldDir: string, newDir: string): PathRewriter {
  const oldTokens = tokenize(oldDir)
  const newComps = tokenize(newDir).comps
  if (oldTokens.comps.length === 0 || newComps.length === 0) {
    throw new Error("relocation paths must contain at least one component")
  }
  if (
    oldTokens.comps.length === newComps.length &&
    oldTokens.comps.every((comp, i) => comp.toLowerCase() === newComps[i].toLowerCase())
  ) {
    throw new Error("old and new locations are identical; nothing to relocate")
  }

  interface Compiled {
    pattern: RegExp
    render(groups: readonly string[]): string
  }

  const compile = (tokens: Tokens, targetComps: string[]): Compiled => {
    const pieces: string[] = []
    if (tokens.leadingSep) {
      pieces.push("([/\\\\]+)")
    } else if (!isDriveLike(tokens.comps[0])) {
      // bare relative form (e.g. session.path): never match mid-path tails;
      // \p{L}\p{N} keeps unicode neighbors from sneaking past the guard
      pieces.push("(?<![\\p{L}\\p{N}_/\\\\])")
    }
    tokens.comps.forEach((comp, index) => {
      if (index > 0) pieces.push("([/\\\\]+)")
      pieces.push(escapeRegExp(comp))
    })
    // reject name continuation so sibling folders ("proj", "proj-old", "proj_v2")
    // never match; separators and quotes after the path remain allowed
    pieces.push("(?![\\p{L}\\p{N}_-])")
    const pattern = new RegExp(pieces.join(""), "giu")

    function render(groups: readonly string[]): string {
      let cursor = 0
      let out = ""
      if (tokens.leadingSep) out += groups[cursor++]

      const runs: string[] = []
      for (let i = 1; i < tokens.comps.length; i++) runs.push(groups[cursor++])

      const sepBefore = (index: number) => (index === 0 ? "" : (runs[index - 1] ?? "/"))

      const shared = Math.min(tokens.comps.length, targetComps.length)
      out += targetComps[0]
      for (let i = 1; i < shared; i++) out += sepBefore(i) + targetComps[i]

      if (targetComps.length > tokens.comps.length) {
        const lastSep = sepBefore(tokens.comps.length - 1) || "/"
        for (const comp of targetComps.slice(shared)) out += lastSep + comp
      }
      // when the new location is shallower, extra old components are dropped
      return out
    }

    return { pattern, render }
  }

  const compiled: Compiled[] = [compile(oldTokens, newComps)]

  // payloads frequently store the same location both with and without the drive
  // letter ("C:/..." in directory fields, "Users/..." in path/title fields);
  // derive the drive-less variant so one rewriter covers both
  if (isDriveLike(oldTokens.comps[0])) {
    compiled.push(
      compile(
        { comps: oldTokens.comps.slice(1), leadingSep: false },
        isDriveLike(newComps[0]) ? newComps.slice(1) : newComps,
      ),
    )
  }

  return {
    matches: (text) =>
      compiled.some(({ pattern }) => {
        // global flags are stateful; always probe from a clean cursor
        pattern.lastIndex = 0
        return pattern.test(text)
      }),
    rewrite: (text) =>
      compiled.reduce((acc, { pattern, render }) => {
        pattern.lastIndex = 0
        if (!pattern.test(acc)) return acc
        pattern.lastIndex = 0
        return acc.replace(pattern, (match: string, ...rest: unknown[]) => {
          // rest = [group1..groupN, offset, subject]
          const groups = rest.slice(0, -2).map((value) => (typeof value === "string" ? value : ""))
          return render(groups)
        })
      }, text),
  }
}
