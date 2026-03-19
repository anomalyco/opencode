import path from "path"
import z from "zod"
import { generateObject } from "ai"
import { git } from "../util/git"
import { Instance } from "../project/instance"
import { PlanStore } from "./plan"
import { Bus } from "@/bus"
import { ParallelEvent } from "./events"
import { Log } from "@/util/log"
import { Worktree } from "../worktree"
import { Provider } from "@/provider/provider"
import type { PlanID, ModelRef } from "./schema"

export namespace MergePipeline {
  const log = Log.create({ service: "merge" })

  export async function run(planID: PlanID): Promise<boolean> {
    const plan = await PlanStore.get(planID)
    const cwd = Instance.worktree

    const completed = plan.workers.filter((w) => w.status === "done" && w.branch)

    if (completed.length === 0) {
      log.warn("no completed workers to merge", { planID })
      return false
    }

    const withDiffs = await Promise.all(
      completed.map(async (worker) => {
        const stat = await git(["diff", "--stat", `HEAD...${worker.branch}`], { cwd })
        const output = outputText(stat.stdout)
        const lines = output.split("\n")
        const lastLine = lines[lines.length - 1] ?? ""
        const insertions = parseInt(lastLine.match(/(\d+) insertion/)?.[1] ?? "0")
        const deletions = parseInt(lastLine.match(/(\d+) deletion/)?.[1] ?? "0")
        log.info("merge branch queued", {
          planID,
          branch: worker.branch!,
          insertions,
          deletions,
          diffSize: insertions + deletions,
        })
        return { worker, diffSize: insertions + deletions }
      }),
    )

    withDiffs.sort((a, b) => a.diffSize - b.diffSize)

    let allSuccess = true

    for (const { worker } of withDiffs) {
      log.info("merge start", { planID, branch: worker.branch! })
      const result = await mergeBranch(planID, worker.branch!, cwd)
      log.info("merge complete", { planID, branch: worker.branch!, result })
      Bus.publish(ParallelEvent.MergeProgress, {
        planID,
        branch: worker.branch!,
        result,
      })

      if (result === "failed") {
        allSuccess = false
        log.error("merge failed", { planID, branch: worker.branch!, error: "Merge conflict could not be resolved" })
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "conflict",
          error: "Merge conflict could not be resolved",
        })
      } else {
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "merged",
        })
      }
    }

    await cleanupPlan(planID)

    return allSuccess
  }

  async function mergeBranch(planID: PlanID, branch: string, cwd: string): Promise<"clean" | "resolved" | "failed"> {
    log.info("merge command", {
      planID,
      branch,
      command: `git merge --no-ff -m "merge: parallel worker ${branch}" ${branch}`,
    })
    const merge = await git(["merge", "--no-ff", "-m", `merge: parallel worker ${branch}`, branch], { cwd })

    if (merge.exitCode === 0) {
      log.info("merge clean", { planID, branch, exitCode: merge.exitCode })
      return "clean"
    }

    log.info("merge needs resolution", { planID, branch, exitCode: merge.exitCode })
    const resolved = await resolveConflicts(planID, branch, cwd)
    if (resolved) return "resolved"

    log.error("merge resolution failed", { planID, branch })
    await git(["merge", "--abort"], { cwd })
    return "failed"
  }

  async function resolveConflicts(planID: PlanID, branch: string, cwd: string): Promise<boolean> {
    const status = await git(["diff", "--name-only", "--diff-filter=U"], { cwd })
    const conflictedFiles = outputText(status.stdout).split("\n").filter(Boolean)

    if (conflictedFiles.length === 0) {
      log.info("no conflicts to resolve", { planID, branch })
      return false
    }

    log.info("resolving conflicts", { planID, branch, fileCount: conflictedFiles.length, files: conflictedFiles })

    const plan = await PlanStore.get(planID)

    for (const file of conflictedFiles) {
      log.info("resolving file", { planID, branch, file })
      const content = await Bun.file(path.join(cwd, file)).text()
      const oursContent = await gitShow(`HEAD:${file}`, cwd)
      const theirsContent = await gitShow(`${branch}:${file}`, cwd)

      const worker = plan.workers.find((w) => w.branch === branch)
      const subtask = plan.subtasks.find((s) => s.id === worker?.subtaskID)

      const resolution = await resolveWithAI({
        file,
        conflictedContent: content,
        oursContent,
        theirsContent,
        globalTask: plan.task,
        subtaskDescription: subtask?.description ?? "",
        model: plan.orchestratorModel,
      })

      await Bun.write(path.join(cwd, file), resolution)
      await git(["add", file], { cwd })
      log.info("file resolved", { planID, branch, file, result: "success" })
    }

    log.info("committing resolved conflicts", { planID, branch, fileCount: conflictedFiles.length })
    const commit = await git(["commit", "--no-edit"], { cwd })
    if (commit.exitCode !== 0) {
      log.error("commit failed after resolution", { planID, branch, exitCode: commit.exitCode })
    }
    return commit.exitCode === 0
  }

  async function resolveWithAI(input: {
    file: string
    conflictedContent: string
    oursContent: string
    theirsContent: string
    globalTask: string
    subtaskDescription: string
    model: ModelRef
  }): Promise<string> {
    const fullModel = await Provider.getModel(input.model.providerID, input.model.modelID)
    const language = await Provider.getLanguage(fullModel)

    const result = await generateObject({
      model: language,
      system: CONFLICT_RESOLUTION_PROMPT,
      messages: [
        {
          role: "user",
          content: buildConflictContext(input),
        },
      ],
      schema: z.object({
        resolvedContent: z.string(),
        explanation: z.string(),
      }),
    })

    return result.object.resolvedContent
  }

  async function gitShow(ref: string, cwd: string): Promise<string> {
    const result = await git(["show", ref], { cwd })
    return outputText(result.stdout)
  }

  async function cleanupPlan(planID: PlanID): Promise<void> {
    const plan = await PlanStore.get(planID)
    const workersToRemove = plan.workers.filter((w) => w.worktreeDir)
    log.info("cleanup worktrees", { planID, worktreeCount: workersToRemove.length })
    await Promise.allSettled(
      workersToRemove.map((w) => {
        log.info("removing worktree", { planID, branch: w.branch, worktreeDir: w.worktreeDir! })
        return Worktree.remove({ directory: w.worktreeDir! })
      }),
    )
    log.info("cleanup complete", { planID })
  }
}

function outputText(input: Uint8Array | undefined): string {
  if (!input?.length) return ""
  return new TextDecoder().decode(input).trim()
}

const CONFLICT_RESOLUTION_PROMPT = `You are a merge conflict resolver for a parallel coding system.

Multiple agents worked on different parts of a task simultaneously, each in an isolated git branch. Their changes are being merged sequentially, and a conflict has occurred.

Your job: produce the CORRECT merged version of the file that incorporates BOTH sides' intent.

Rules:
1. Understand what each side was trying to accomplish from the context provided.
2. Produce a version that satisfies both changes. Do NOT drop either side's work.
3. If the changes are truly incompatible (e.g., both rename the same function differently), prefer the change that better aligns with the global task description.
4. The resolved file must be syntactically valid.
5. Return the COMPLETE file content, not a diff.`

function buildConflictContext(input: {
  file: string
  conflictedContent: string
  oursContent: string
  theirsContent: string
  globalTask: string
  subtaskDescription: string
}): string {
  return `## File: ${input.file}

## Global Task
${input.globalTask}

## Incoming Branch's Subtask
${input.subtaskDescription}

## Current version (already merged branches):
\`\`\`
${input.oursContent}
\`\`\`

## Incoming version (branch being merged):
\`\`\`
${input.theirsContent}
\`\`\`

## Conflicted merge result (with conflict markers):
\`\`\`
${input.conflictedContent}
\`\`\`

Produce the resolved file content.`
}
