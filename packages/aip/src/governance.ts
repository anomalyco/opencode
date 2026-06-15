import { writeFileSync } from "node:fs"
import { lineDiff } from "@opencode-ai/evolve"
import type { Ontology } from "./ontology.ts"
import type { ActionBranch, ProposedChange, ReviewDecision } from "./types.ts"
import type { ActionType } from "./actions.ts"

let branchSeq = 0

/** Wrap a proposed change into a reviewable branch (the "action branch"). */
export function openBranch(action: ActionType<any>, change: ProposedChange, rationale?: string): ActionBranch {
  return {
    id: `branch-${++branchSeq}`,
    actionName: action.name,
    permission: action.permission,
    change,
    rationale,
    status: "proposed",
  }
}

/** A human-in-the-loop reviewer. */
export interface Reviewer {
  review(branch: ActionBranch): ReviewDecision | Promise<ReviewDecision>
}

/**
 * Policy-based reviewer for automation/tests: approves a branch only when its
 * permission is in the allowlist (mirrors a "always allow" ruleset). Everything
 * else is rejected, modelling a conservative default.
 */
export class AutoReviewer implements Reviewer {
  constructor(private readonly allow: string[] = []) {}
  review(branch: ActionBranch): ReviewDecision {
    if (this.allow.includes(branch.permission)) return { decision: "approve" }
    return { decision: "reject", feedback: `permission "${branch.permission}" not in allowlist` }
  }
}

/**
 * Adapter to the real opencode permission service. `ask` should resolve to the
 * human's reply ("once"/"always" = approve, "reject" = deny), matching
 * `Permission.Service.ask/reply` in packages/opencode/src/permission.
 */
export type AskFn = (input: { permission: string; metadata: Record<string, unknown> }) => Promise<
  "once" | "always" | "reject"
>

export class PermissionReviewer implements Reviewer {
  constructor(private readonly ask: AskFn) {}
  async review(branch: ActionBranch): Promise<ReviewDecision> {
    const reply = await this.ask({
      permission: branch.permission,
      metadata: { branchId: branch.id, action: branch.actionName, summary: branch.change.summary },
    })
    return reply === "reject"
      ? { decision: "reject", feedback: "rejected by reviewer" }
      : { decision: "approve" }
  }
}

/** Run a branch through review, returning a new branch with the decided status. */
export async function review(branch: ActionBranch, reviewer: Reviewer): Promise<ActionBranch> {
  const decision = await reviewer.review(branch)
  return {
    ...branch,
    status: decision.decision === "approve" ? "approved" : "rejected",
    feedback: decision.feedback,
  }
}

export interface MergeResult {
  merged: boolean
  branch: ActionBranch
  /** What actually happened (property set, file written, answer returned). */
  effect: string
  diff?: string
}

export interface MergeOptions {
  ontology: Ontology
  /** Write skill files to disk on update-skill changes. Off by default (CI/tests). */
  write?: boolean
}

/**
 * Apply an approved branch — the "write back". Property updates land in the
 * ontology immediately; skill rewrites produce a diff and (optionally) write the
 * file, with promotion still going through the repo's PR + test gate.
 */
export function merge(branch: ActionBranch, opts: MergeOptions): MergeResult {
  if (branch.status !== "approved") {
    return { merged: false, branch, effect: `not merged (status ${branch.status})` }
  }
  const change = branch.change
  const merged: ActionBranch = { ...branch, status: "merged" }

  switch (change.kind) {
    case "update-property": {
      if (!change.targetId || !change.property) {
        return { merged: false, branch, effect: "invalid update-property change" }
      }
      opts.ontology.setProperty(change.targetId, change.property, change.value ?? null)
      return { merged: true, branch: merged, effect: `set ${change.property} on ${change.targetId}` }
    }
    case "update-skill": {
      const diff = lineDiff(change.before ?? "", change.newBody ?? "")
      if (opts.write && change.skillPath) writeFileSync(change.skillPath, change.newBody ?? "", "utf8")
      return {
        merged: true,
        branch: merged,
        effect: opts.write && change.skillPath ? `wrote ${change.skillPath}` : "skill change staged (not written)",
        diff,
      }
    }
    case "answer":
      return { merged: true, branch: merged, effect: `answered: ${change.answer ?? ""}` }
    case "noop":
    default:
      return { merged: true, branch: merged, effect: "no-op" }
  }
}
