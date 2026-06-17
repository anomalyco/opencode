import fs from "fs/promises"
import path from "path"
import { goalPaths } from "./root"
import type { VerificationEvidence } from "./types"
import type { InstanceContext } from "@/project/instance-context"

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

export async function appendGoalEvidence(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  evidence: VerificationEvidence,
): Promise<void> {
  const paths = goalPaths(ctx)
  await fs.mkdir(path.dirname(paths.activeEvidence), { recursive: true })
  await fs.appendFile(paths.activeEvidence, JSON.stringify(evidence) + "\n", "utf8")
}

export async function readGoalEvidence(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
): Promise<VerificationEvidence[]> {
  const paths = goalPaths(ctx)
  let text: string
  try {
    text = await fs.readFile(paths.activeEvidence, "utf8")
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return []
    throw error
  }

  const evidence: VerificationEvidence[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      evidence.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return evidence
}
