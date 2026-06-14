import type { GateCheck, GateResult, Skill } from "./types.ts"
import { headings, skillBytes } from "./skill.ts"

/** GEPA caps skill files; daemoncode mirrors the 15KB budget. */
export const MAX_SKILL_BYTES = 15 * 1024

export function checkNonEmpty(skill: Skill): GateCheck {
  const ok = skill.body.trim().length > 0
  return { name: "non-empty", passed: ok, reason: ok ? undefined : "skill body is empty" }
}

export function checkSize(skill: Skill, maxBytes = MAX_SKILL_BYTES): GateCheck {
  const bytes = skillBytes(skill)
  const ok = bytes <= maxBytes
  return {
    name: "size",
    passed: ok,
    reason: ok ? undefined : `${bytes} bytes exceeds ${maxBytes} byte limit`,
  }
}

/** Frontmatter `name` must be preserved so the skill keeps its identity. */
export function checkNamePreserved(original: Skill, variant: Skill): GateCheck {
  const ok = variant.name === original.name
  return {
    name: "name-preserved",
    passed: ok,
    reason: ok ? undefined : `name changed from "${original.name}" to "${variant.name}"`,
  }
}

/**
 * Semantic preservation: required headings must survive the rewrite. A mutation
 * is allowed to add/reorganize, but it cannot silently drop mandated sections.
 */
export function checkRequiredHeadings(variant: Skill, required: string[]): GateCheck {
  if (required.length === 0) return { name: "required-headings", passed: true }
  const present = new Set(headings(variant).map((h) => h.toLowerCase()))
  const missing = required.filter((h) => !present.has(h.toLowerCase()))
  return {
    name: "required-headings",
    passed: missing.length === 0,
    reason: missing.length === 0 ? undefined : `missing headings: ${missing.join(", ")}`,
  }
}

export interface GateOptions {
  maxBytes?: number
  requiredHeadings?: string[]
}

/** Run every hard constraint; a candidate must pass all to be eligible. */
export function runGates(original: Skill, variant: Skill, opts: GateOptions = {}): GateResult {
  const checks: GateCheck[] = [
    checkNonEmpty(variant),
    checkSize(variant, opts.maxBytes),
    checkNamePreserved(original, variant),
    checkRequiredHeadings(variant, opts.requiredHeadings ?? []),
  ]
  return { passed: checks.every((c) => c.passed), checks }
}
