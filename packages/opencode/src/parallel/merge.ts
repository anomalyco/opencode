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
import type { PlanID, ModelRef, SubtaskID } from "./schema"

export type FileScopeViolation = {
  subtaskID: SubtaskID
  title: string
  outOfScopeFiles: string[]
}

export namespace MergePipeline {
  const log = Log.create({ service: "merge" })

  /**
   * Validate that workers stayed within their declared fileScope.
   * Returns violations (out-of-scope file changes) for logging/warning.
   */
  export async function validateFileScope(planID: PlanID): Promise<FileScopeViolation[]> {
    const plan = await PlanStore.get(planID)
    const cwd = Instance.worktree
    const violations: FileScopeViolation[] = []

    for (const worker of plan.workers) {
      if (!worker.branch || worker.status !== "done") continue

      const subtask = plan.subtasks.find((s) => s.id === worker.subtaskID)
      if (!subtask) continue

      // Get list of files changed in this worker's branch
      const result = await git(["diff", "--name-only", `HEAD...${worker.branch}`], { cwd })
      const changedFiles = outputText(result.stdout).split("\n").filter(Boolean)

      // Check each changed file against declared fileScope
      const outOfScopeFiles = changedFiles.filter((file) => {
        return !subtask.fileScope.some((scope) => {
          // Match if file equals scope exactly, or file is under scope directory
          return file === scope || file.startsWith(scope + "/") || file.startsWith(scope)
        })
      })

      if (outOfScopeFiles.length > 0) {
        violations.push({
          subtaskID: worker.subtaskID,
          title: subtask.title,
          outOfScopeFiles,
        })
        log.warn("file scope violation detected", {
          planID,
          subtaskID: worker.subtaskID,
          subtaskTitle: subtask.title,
          declaredScope: subtask.fileScope,
          outOfScopeFiles,
        })
      }
    }

    return violations
  }

  export async function run(planID: PlanID): Promise<boolean> {
    const mergeStartTime = Date.now()
    const plan = await PlanStore.get(planID)
    const cwd = Instance.worktree

    const completed = plan.workers.filter((w) => w.status === "done" && w.branch)

    if (completed.length === 0) {
      log.warn("no completed workers to merge", { planID })
      return false
    }

    // Validate file scope compliance before merging
    const violations = await validateFileScope(planID)
    if (violations.length > 0) {
      log.warn("file scope violations detected - workers modified files outside declared scope", {
        planID,
        violationCount: violations.length,
        violations: violations.map((v) => ({
          subtask: v.title,
          files: v.outOfScopeFiles,
        })),
      })
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

    await cleanupPlan(planID, allSuccess)

    log.info("all merges complete", { planID, durationMs: Date.now() - mergeStartTime })

    return allSuccess
  }

  async function mergeBranch(planID: PlanID, branch: string, cwd: string): Promise<"clean" | "resolved" | "failed"> {
    // Get plan and worker info for better merge message
    const plan = await PlanStore.get(planID)
    const worker = plan.workers.find((w) => w.branch === branch)
    const subtask = worker ? plan.subtasks.find((s) => s.id === worker.subtaskID) : undefined

    // Build descriptive merge message
    const subtaskTitle = subtask?.title ?? "Unknown subtask"
    const taskPreview = plan.task.slice(0, 60)
    const mergeMessage = `merge: ${subtaskTitle}\n\nTask: ${taskPreview}\nWorker: ${branch}\nPlan: ${planID.slice(0, 12)}`

    log.info("merge command", {
      planID,
      branch,
      subtaskTitle,
      command: `git merge --no-ff -m "${mergeMessage.split("\n")[0]}" ${branch}`,
    })
    const merge = await git(["merge", "--no-ff", "-m", mergeMessage, branch], { cwd })

    if (merge.exitCode === 0) {
      const merged = await git(["merge-base", "--is-ancestor", branch, "HEAD"], { cwd })
      if (merged.exitCode === 0) {
        log.info("merge clean", { planID, branch, subtaskTitle, exitCode: merge.exitCode })
        return "clean"
      }
      log.error("merge verification failed", { planID, branch, subtaskTitle })
      return "failed"
    }

    log.info("merge needs resolution", { planID, branch, subtaskTitle, exitCode: merge.exitCode })
    const resolved = await resolveConflicts(planID, branch, cwd)
    if (resolved) {
      const merged = await git(["merge-base", "--is-ancestor", branch, "HEAD"], { cwd })
      if (merged.exitCode === 0) return "resolved"
      log.error("merge verification failed after resolution", { planID, branch, subtaskTitle })
      return "failed"
    }

    log.error("merge resolution failed", { planID, branch, subtaskTitle })
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

    // Cache for git show results to avoid redundant calls
    const showCache = new Map<string, string>()
    const cachedGitShow = async (ref: string, file: string): Promise<string> => {
      const key = `${ref}:${file}`
      if (showCache.has(key)) return showCache.get(key)!
      const content = await gitShow(key, cwd)
      showCache.set(key, content)
      return content
    }

    for (const file of conflictedFiles) {
      log.info("resolving file", { planID, branch, file })
      const content = await Bun.file(path.join(cwd, file)).text()
      const oursContent = await cachedGitShow("HEAD", file)
      const theirsContent = await cachedGitShow(branch, file)

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

  async function cleanupPlan(planID: PlanID, allSuccess: boolean): Promise<void> {
    const plan = await PlanStore.get(planID)
    const workersToRemove = allSuccess
      ? plan.workers.filter((w) => w.worktreeDir)
      : plan.workers.filter((w) => w.status === "merged" && w.worktreeDir)
    log.info("cleanup worktrees", {
      planID,
      mode: allSuccess ? "all" : "merged-only",
      worktreeCount: workersToRemove.length,
    })
    await Promise.allSettled(
      workersToRemove.map((w) => {
        log.info("removing worktree", { planID, branch: w.branch, worktreeDir: w.worktreeDir! })
        return Worktree.remove({ directory: w.worktreeDir! })
      }),
    )
    if (!allSuccess) {
      const kept = plan.workers.filter((w) => w.status !== "merged" && w.worktreeDir)
      log.warn("kept unmerged worktrees for recovery", {
        planID,
        count: kept.length,
        dirs: kept.map((w) => w.worktreeDir),
      })
    }
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
