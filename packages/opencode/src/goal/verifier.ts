import fs from "fs/promises"
import path from "path"
import { appendGoalEvidence } from "./evidence"
import type { FileContainsVerificationRequirement, FileEvidence, FileExistsVerificationRequirement, VerificationRequirement } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export interface VerifyRequirementInput {
  id: string
  goalId: string
  stepId?: string
  requirement: VerificationRequirement
  createdAt?: string
}

async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath)
    return true
  } catch {
    return false
  }
}

function resolveRequirementPath(ctx: Pick<InstanceContext, "directory" | "worktree">, requirementPath: string): string {
  return path.isAbsolute(requirementPath) ? requirementPath : path.join(ctx.worktree !== "/" ? ctx.worktree : ctx.directory, requirementPath)
}

async function verifyFileExists(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  input: VerifyRequirementInput & { requirement: FileExistsVerificationRequirement },
): Promise<FileEvidence> {
  const observed = await fileExists(resolveRequirementPath(ctx, input.requirement.path))
  return {
    id: input.id,
    goalId: input.goalId,
    stepId: input.stepId,
    type: "FILE_EXISTS",
    path: input.requirement.path,
    observed,
    passed: observed,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

async function verifyFileContains(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  input: VerifyRequirementInput & { requirement: FileContainsVerificationRequirement },
): Promise<FileEvidence> {
  let observed: string | false = false
  try {
    const contents = await fs.readFile(resolveRequirementPath(ctx, input.requirement.path), "utf8")
    if (contents.includes(input.requirement.pattern)) observed = input.requirement.pattern
  } catch {
    observed = false
  }

  return {
    id: input.id,
    goalId: input.goalId,
    stepId: input.stepId,
    type: "FILE_CONTAINS",
    path: input.requirement.path,
    expected: input.requirement.pattern,
    observed,
    passed: observed === input.requirement.pattern,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export async function verifyRequirement(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  input: VerifyRequirementInput,
): Promise<FileEvidence> {
  let evidence: FileEvidence
  if (input.requirement.type === "FILE_EXISTS") {
    evidence = await verifyFileExists(ctx, { ...input, requirement: input.requirement })
  } else if (input.requirement.type === "FILE_CONTAINS") {
    evidence = await verifyFileContains(ctx, { ...input, requirement: input.requirement })
  } else {
    throw new Error(`Unsupported verification requirement: ${input.requirement.type}`)
  }

  await appendGoalEvidence(ctx, evidence)
  return evidence
}
