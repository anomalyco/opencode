import type { RunResult, Skill } from "./types.ts"
import { serializeSkill, writeSkill } from "./skill.ts"

/**
 * Minimal line-level unified-style diff (added/removed lines). Pure and
 * dependency-free — enough to surface what a mutation changed in a report or PR
 * body. Not a full Myers diff; it reports the line-set delta.
 */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n")
  const b = after.split("\n")
  const aSet = new Set(a)
  const bSet = new Set(b)
  const removed = a.filter((l) => !bSet.has(l))
  const added = b.filter((l) => !aSet.has(l))
  const out: string[] = []
  for (const l of removed) out.push(`- ${l}`)
  for (const l of added) out.push(`+ ${l}`)
  return out.join("\n")
}

export function skillDiff(before: Skill, after: Skill): string {
  return lineDiff(serializeSkill(before), serializeSkill(after))
}

export interface DeployResult {
  changed: boolean
  path: string
  diff: string
}

/**
 * Write the winning variant back to the skill file. The loop never deploys
 * automatically beyond writing the artifact; promotion to the live skill is
 * meant to go through the normal PR + test gate (the same flow the rest of the
 * repo uses), so this only materializes the file for that PR.
 */
export function deployBest(run: RunResult, original: Skill, path = original.path): DeployResult {
  const best = run.best.candidate.skill
  const diff = skillDiff(original, best)
  const changed = run.improvedFromBaseline && diff.trim().length > 0
  // Only materialize the file when there is an improvement AND a destination;
  // callers may also use this purely to obtain the diff (e.g. for a PR body).
  if (changed && path) writeSkill(best, path)
  return { changed, path, diff }
}
