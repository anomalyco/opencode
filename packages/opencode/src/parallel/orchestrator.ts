import { PlanStore } from "./plan"
import { Decomposition } from "./decomposition"
import { WorkerManager } from "./worker"
import { Recovery } from "./recovery"
import { Integration } from "./integration"
import * as Scheduler from "./scheduler"
import { lint } from "./lint"
import { rewrite, validate } from "./rewrite"
import { analyze as analyzeArtifacts, validate as validateArtifacts, rewrite as rewriteArtifacts } from "./artifact"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Log } from "@/util/log"
import { fn } from "@/util/fn"
import type { Plan, PlanID, ModelRef, SubtaskID } from "./schema"
import { Plan as PlanSchema, PlanID as PlanIDSchema, SubtaskID as SubtaskIDSchema } from "./schema"
import { git } from "@/util/git"
import { access } from "fs/promises"
import { constants } from "fs"
import z from "zod"
import { Metrics } from "./metrics"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

  // Track active abort controllers so cancel() can stop running executions
  const activeExecutions = new Map<PlanID, AbortController>()

  type Detail = {
    code: string
    stage: string
    message: string
    at: number
  }

  type Outcome = {
    status: "done" | "partial_success" | "failed"
    merged: number
    failed: number
    unresolved: number
  }

  function unresolved(workers: Plan["workers"]) {
    return workers.filter((worker) => !["merged", "failed", "conflict"].includes(worker.status))
  }

  function inflight(workers: Plan["workers"]) {
    return workers.filter((worker) => ["pending", "spawning", "running", "stopping"].includes(worker.status))
  }

  export function resolveOutcome(input: {
    workers: Plan["workers"]
    integrationSuccess: boolean
    publishSuccess: boolean
  }): Outcome {
    const merged = input.workers.filter((worker) => worker.status === "merged").length
    const failed = input.workers.filter((worker) => worker.status === "failed" || worker.status === "conflict").length
    const open = unresolved(input.workers).length

    if (
      input.integrationSuccess &&
      input.publishSuccess &&
      failed === 0 &&
      open === 0 &&
      merged === input.workers.length
    ) {
      return { status: "done", merged, failed, unresolved: open }
    }

    if (open === 0 && merged > 0) {
      return { status: "partial_success", merged, failed, unresolved: open }
    }

    return { status: "failed", merged, failed, unresolved: open }
  }

  function pick(err: unknown, key: "code" | "stage" | "message"): string | undefined {
    if (!err || typeof err !== "object") return
    if (!("data" in err)) return
    const data = err.data
    if (!data || typeof data !== "object") return
    if (!(key in data)) return
    const value = data[key as keyof typeof data]
    if (typeof value !== "string") return
    return value
  }

  function text(err: unknown): string {
    const msg = pick(err, "message")
    if (msg) return msg
    if (err instanceof Error) return err.message
    return String(err)
  }

  function issue(input: { code: string; stage: string; message: string }) {
    const err = new Error(input.message) as Error & { code?: string; stage?: string }
    err.code = input.code
    err.stage = input.stage
    return err
  }

  function detail(err: unknown): Detail {
    const code =
      (err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined) ??
      pick(err, "code") ??
      "unknown"
    const stage =
      (err instanceof Error && "stage" in err && typeof err.stage === "string" ? err.stage : undefined) ??
      pick(err, "stage") ??
      "unknown"
    return {
      code,
      stage,
      message: text(err),
      at: Date.now(),
    }
  }

  async function fail(planID: PlanID, err: unknown) {
    const data = detail(err)
    await PlanStore.update({ id: planID, status: "failed", error: data }).catch(async () => {
      await PlanStore.update({ id: planID, error: data }).catch(() => {})
      await PlanStore.transition({ id: planID, status: "failed" }).catch(() => {})
    })
  }

  async function stage<T>(name: string, fn: () => Promise<T>) {
    try {
      return await fn()
    } catch (err) {
      throw issue({
        code: `${name}_failed`,
        stage: name,
        message: text(err),
      })
    }
  }

  async function preflight(plan: Plan): Promise<void> {
    const root =
      Project.get(plan.projectID)?.worktree ?? plan.workers.find((w) => w.worktreeDir)?.worktreeDir ?? process.cwd()

    const gitCheck = await git(["rev-parse", "--is-inside-work-tree"], { cwd: root })
    if (gitCheck.exitCode !== 0) {
      throw issue({
        code: "git_not_ready",
        stage: "preflight",
        message: `Git worktree check failed at ${root}`,
      })
    }

    const writable = await access(root, constants.W_OK)
      .then(() => true)
      .catch(() => false)
    if (!writable) {
      throw issue({
        code: "worktree_readonly",
        stage: "preflight",
        message: `Worktree is not writable: ${root}`,
      })
    }

    let subtasks = plan.subtasks
    let changed = false

    const ids = new Set(subtasks.map((subtask) => subtask.id))
    for (const subtask of subtasks) {
      for (const dep of subtask.dependencies) {
        if (ids.has(dep)) continue
        throw issue({
          code: "dependency_missing",
          stage: "preflight",
          message: `Subtask "${subtask.title}" references missing dependency ${dep}`,
        })
      }
    }

    const seen = new Set<string>()
    const refs = [
      plan.orchestratorModel,
      plan.workerModel,
      ...subtasks.flatMap((subtask) => (subtask.model ? [subtask.model] : [])),
    ]
    for (const ref of refs) {
      const key = `${ref.providerID}/${ref.modelID}`
      if (seen.has(key)) continue
      seen.add(key)

      const model = await Provider.getModel(ref.providerID, ref.modelID).catch(() => {
        throw issue({
          code: "model_not_found",
          stage: "preflight",
          message: `Model unavailable: ${key}`,
        })
      })

      await Provider.getLanguage(model).catch(() => {
        throw issue({
          code: "model_unavailable",
          stage: "preflight",
          message: `Model failed preflight: ${key}`,
        })
      })
    }

    const marks = new Map<string, number>()
    const graph = new Map(subtasks.map((subtask) => [String(subtask.id), subtask.dependencies.map(String)]))
    const walk = (id: string): boolean => {
      const mark = marks.get(id) ?? 0
      if (mark === 1) return true
      if (mark === 2) return false
      marks.set(id, 1)
      const deps = graph.get(id) ?? []
      for (const dep of deps) {
        if (walk(dep)) return true
      }
      marks.set(id, 2)
      return false
    }

    for (const id of graph.keys()) {
      if (!walk(id)) continue
      throw issue({
        code: "dependency_cycle",
        stage: "preflight",
        message: "Subtask dependency graph has a cycle",
      })
    }

    // Validate file scope overlaps based on scheduler mode
    const cfg = await Config.get()
    const schedulerMode = cfg.parallel?.scheduler_mode ?? "off"
    const validation = Scheduler.validatePlan(subtasks, schedulerMode)

    if (!validation.valid) {
      throw issue({
        code: "file_scope_overlap",
        stage: "preflight",
        message: validation.error ?? "File scope overlaps detected",
      })
    }

    // Log wave scheduling info in auto mode
    if (schedulerMode === "auto" && validation.analysis.overlaps.length > 0) {
      log.warn("file scope overlaps detected - using wave scheduling", {
        overlaps: validation.analysis.overlaps.length,
        waves: validation.analysis.waves.length,
        parallelizable: validation.analysis.parallelizableCount,
        serial: validation.analysis.serialCount,
      })
    }

    // Validate and optionally rewrite based on lint_mode
    const lintMode = cfg.parallel?.lint_mode ?? "off"
    if (lintMode !== "off") {
      const lintReport = lint(subtasks)
      const lintValidation = validate(subtasks, lintMode)

      if (lintMode === "strict" && !lintValidation.valid) {
        throw issue({
          code: "plan_lint_failed",
          stage: "preflight",
          message: lintValidation.error ?? "Plan failed lint validation",
        })
      }

      if (lintMode === "warn" && lintReport.issues.length > 0) {
        for (const issue of lintReport.issues) {
          log.warn(`[${issue.code}] ${issue.message}`, {
            severity: issue.severity,
            subtasks: issue.subtasks.map(String),
            files: issue.files,
            recommendation: issue.recommendation,
          })
        }
      }

      if (lintMode === "auto" && lintReport.issues.length > 0) {
        const rewritten = rewrite(subtasks, lintReport)
        if (rewritten.addedWiringSubtask) {
          log.info("plan auto-rewritten to isolate shared files", {
            originalSubtasks: subtasks.length,
            rewrittenSubtasks: rewritten.rewrittenSubtasks.length,
            wiringSubtask: String(rewritten.wiringSubtaskId),
          })
          subtasks = rewritten.rewrittenSubtasks
          changed = true
        }
      }
    }

    // Validate and optionally rewrite based on artifact_mode
    const artifactMode = cfg.parallel?.artifact_mode ?? "off"
    if (artifactMode !== "off") {
      const artifactReport = analyzeArtifacts(subtasks)
      const artifactValidation = validateArtifacts(subtasks, artifactMode)

      if (artifactMode === "strict" && !artifactValidation.valid) {
        throw issue({
          code: "artifact_deps_failed",
          stage: "preflight",
          message: artifactValidation.error ?? "Artifact dependency validation failed",
        })
      }

      if (artifactMode === "warn" && artifactReport.diagnostics.length > 0) {
        for (const diagnostic of artifactReport.diagnostics) {
          log.warn(`[${diagnostic.code}] ${diagnostic.message}`, {
            severity: diagnostic.severity,
            subtasks: diagnostic.subtasks.map(String),
            artifacts: diagnostic.artifacts,
            recommendation: diagnostic.recommendation,
          })
        }
      }

      if (artifactMode === "auto" && artifactReport.missingDependencies.size > 0) {
        const { rewritten, addedDeps } = rewriteArtifacts(subtasks, artifactReport)
        if (addedDeps > 0) {
          log.info("plan auto-rewritten to add implicit dependencies", {
            originalSubtasks: subtasks.length,
            rewrittenSubtasks: rewritten.length,
            addedDependencies: addedDeps,
          })
          subtasks = rewritten
          changed = true
        }
      }
    }

    if (!changed) return

    const workers = subtasks.map((subtask) => {
      const existing = plan.workers.find((worker) => worker.subtaskID === subtask.id)
      if (existing) return existing
      return {
        subtaskID: subtask.id,
        status: "pending" as const,
      }
    })

    await PlanStore.update({
      id: plan.id,
      subtasks,
      workers,
      status: plan.status,
    })
  }

  /**
   * Resolve model defaults from config.
   * Priority: explicit input > config.parallel > project default model
   */
  export async function resolveModels(input?: {
    orchestratorModel?: ModelRef
    workerModel?: ModelRef
  }): Promise<{ orchestratorModel: ModelRef; workerModel: ModelRef }> {
    const cfg = await Config.get()
    const defaultModel = await Provider.defaultModel()

    function parseConfigModel(modelStr?: string): ModelRef | undefined {
      if (!modelStr) return undefined
      const parsed = Provider.parseModel(modelStr)
      if (!parsed) return undefined
      return { providerID: parsed.providerID, modelID: parsed.modelID }
    }

    const orchestratorModel = input?.orchestratorModel ??
      parseConfigModel(cfg.parallel?.orchestrator_model) ?? {
        providerID: defaultModel.providerID,
        modelID: defaultModel.modelID,
      }

    const workerModel = input?.workerModel ??
      parseConfigModel(cfg.parallel?.worker_model) ?? {
        providerID: defaultModel.providerID,
        modelID: defaultModel.modelID,
      }

    return { orchestratorModel, workerModel }
  }

  export async function checkPlanLimit(projectID: Plan["projectID"]): Promise<void> {
    const cfg = await Config.get()
    const limit = cfg.parallel?.max_plans_per_project ?? 5
    const active = await PlanStore.listActiveByProject(projectID)
    if (active.length >= limit) {
      throw new Error(
        `Parallel plan limit reached for project: ${active.length} active plans (max ${limit}). ` +
          "Cancel or complete existing plans before creating new ones.",
      )
    }
  }

  export async function checkRunningPlan(projectID: Plan["projectID"]): Promise<void> {
    const active = await PlanStore.listByProjectAndStatus(projectID, "running")
    const spawning = await PlanStore.listByProjectAndStatus(projectID, "spawning")
    const merging = await PlanStore.listByProjectAndStatus(projectID, "merging")
    const integrating = await PlanStore.listByProjectAndStatus(projectID, "integrating")
    const integrated = await PlanStore.listByProjectAndStatus(projectID, "integrated")
    const publishing = await PlanStore.listByProjectAndStatus(projectID, "publishing")
    const running = [...active, ...spawning, ...merging, ...integrating, ...integrated, ...publishing]

    if (running.length > 0) {
      const existingPlan = running[0]
      throw new Error(
        `A parallel plan is already running: ${existingPlan.id}. ` +
          `Cancel it with "parallel_cancel ${existingPlan.id}" or wait for it to complete.`,
      )
    }
  }

  export async function checkSubtaskLimit(subtaskCount: number): Promise<void> {
    const cfg = await Config.get()
    const maxSubtasks = cfg.parallel?.max_subtasks ?? 20
    const warningThreshold = Math.floor(maxSubtasks * 0.8)

    if (subtaskCount > maxSubtasks) {
      throw new Error(
        `Subtask limit exceeded: ${subtaskCount} subtasks (max ${maxSubtasks}). ` +
          `Split the task into smaller pieces or increase max_subtasks in config.`,
      )
    }

    if (subtaskCount > warningThreshold) {
      log.warn("subtask count approaching limit", {
        count: subtaskCount,
        max: maxSubtasks,
        threshold: warningThreshold,
      })
    }
  }

  export const create = fn(
    z.object({
      projectID: PlanSchema.shape.projectID,
      sessionID: PlanSchema.shape.sessionID,
      task: PlanSchema.shape.task,
      orchestratorModel: PlanSchema.shape.orchestratorModel.optional(),
      workerModel: PlanSchema.shape.workerModel.optional(),
      publishMode: z.enum(["new-branch", "unstaged", "direct"]).optional(),
    }),
    async (input): Promise<Plan> => {
      await checkPlanLimit(input.projectID)
      await checkRunningPlan(input.projectID)

      const models = await resolveModels({
        orchestratorModel: input.orchestratorModel,
        workerModel: input.workerModel,
      })
      const cfg = await Config.get()
      const mode = input.publishMode ?? cfg.parallel?.publish_mode ?? "new-branch"

      const plan = await PlanStore.create({
        projectID: input.projectID,
        sessionID: input.sessionID,
        task: input.task,
        ...models,
        publishMode: mode,
      })

      const codebaseContext = await Decomposition.gatherCodebaseContext(Instance.directory)
      const formattedContext = Decomposition.formatCodebaseContext(codebaseContext)

      const subtasks = await Decomposition.decompose({
        task: input.task,
        model: models.orchestratorModel,
        codebaseContext: formattedContext,
      })

      await checkSubtaskLimit(subtasks.length)

      const updated = await PlanStore.update({
        id: plan.id,
        subtasks,
        workers: subtasks.map((st) => ({
          subtaskID: st.id,
          status: "pending" as const,
        })),
        status: "proposed",
      })

      const cfg2 = await Config.get()
      const autoApprove = cfg2.parallel?.require_approval === false
      if (autoApprove) {
        await approve(updated.id)
      }

      log.info("plan created", {
        planID: plan.id,
        subtaskCount: subtasks.length,
        autoApprove,
        publishMode: mode,
      })
      return updated
    },
  )

  export async function execute(planID: PlanID, abort: AbortSignal): Promise<void> {
    log.info("executing plan", { planID })

    await stage("spawning", async () => {
      await PlanStore.transition({ id: planID, status: "spawning" })
      const plan = await PlanStore.get(planID)
      await WorkerManager.spawnAll(plan, abort)
    })

    await stage("running", async () => {
      await PlanStore.transition({ id: planID, status: "running" })
      await WorkerManager.waitAll(planID, abort)
    })

    const afterWait = await PlanStore.get(planID)
    const active = inflight(afterWait.workers)
    if (active.length > 0) {
      await PlanStore.update({
        id: planID,
        status: "failed",
        error: {
          code: "workers_incomplete",
          stage: "running",
          message: `Workers still active after wait: ${active.length}`,
          at: Date.now(),
        },
      })
      Metrics.recordPlanOutcome("failed")
      log.error("workers still active after wait; skipping merge", {
        planID,
        active: active.map((worker) => ({
          subtaskID: worker.subtaskID,
          status: worker.status,
        })),
      })
      return
    }

    await PlanStore.transition({ id: planID, status: "merging" })
    await PlanStore.transition({ id: planID, status: "integrating" })
    const integrationResult = await stage("integrating", async () => Integration.integrate(planID))

    if (integrationResult.merged.length === 0) {
      await PlanStore.transition({ id: planID, status: "failed" })
      const finalPlan = await PlanStore.get(planID)
      await Recovery.cleanupWorktrees(finalPlan)
      Metrics.recordPlanOutcome("failed")
      log.info("plan execution complete", {
        planID,
        status: "failed",
        integrationBranch: integrationResult.branch,
        publishMode: undefined,
      })
      return
    }

    await PlanStore.transition({ id: planID, status: "integrated" })

    // Publish phase - mode-dependent
    const cfg = await Config.get()
    const plan = await PlanStore.get(planID)
    const publishMode = plan.publishMode ?? cfg.parallel?.publish_mode ?? "new-branch"

    await PlanStore.transition({ id: planID, status: "publishing" })
    const publishResult = await stage("publishing", async () => Integration.publish(planID, publishMode))

    // Determine final status based on all outcomes
    const finalPlan = await PlanStore.get(planID)
    const result = resolveOutcome({
      workers: finalPlan.workers,
      integrationSuccess: integrationResult.success,
      publishSuccess: publishResult.success,
    })
    const finalStatus = result.status

    if (result.unresolved > 0) {
      log.error("plan has unresolved workers at completion", {
        planID,
        unresolved: result.unresolved,
        statuses: unresolved(finalPlan.workers).map((worker) => ({
          subtaskID: worker.subtaskID,
          status: worker.status,
        })),
      })
    }

    if (finalStatus === "partial_success") {
      log.info("plan partial success", {
        planID,
        merged: result.merged,
        failed: result.failed,
        integrationBranch: integrationResult.branch,
        publishMode,
      })
    }

    await PlanStore.transition({ id: planID, status: finalStatus })
    Metrics.recordPlanOutcome(finalStatus)

    if (finalStatus === "failed" && result.unresolved === 0) {
      await Recovery.cleanupWorktrees(finalPlan)
    }

    log.info("plan execution complete", {
      planID,
      status: finalStatus,
      integrationBranch: integrationResult.branch,
      publishMode,
    })
  }

  export const approve = fn(PlanIDSchema.zod, async (planID): Promise<Plan> => {
    const current = await PlanStore.get(planID)
    await preflight(current).catch(async (err) => {
      const data = detail(err)
      await PlanStore.update({ id: planID, error: data }).catch(() => {})
      throw err
    })

    const plan = await PlanStore.transition({ id: planID, status: "approved" })
    log.info("plan approved", { planID })

    const controller = new AbortController()
    activeExecutions.set(planID, controller)
    const run = Instance.bind((id: PlanID, abort: AbortSignal) => execute(id, abort))

    run(planID, controller.signal)
      .catch(async (error) => {
        log.error("plan execution failed", { planID, error })
        Metrics.recordPlanOutcome("failed")
        try {
          const plan = await PlanStore.get(planID)
          await Recovery.cleanupWorktrees(plan)
        } catch {}
        await fail(planID, error)
      })
      .finally(() => {
        activeExecutions.delete(planID)
      })

    return plan
  })

  export const cancel = fn(PlanIDSchema.zod, async (planID): Promise<void> => {
    const controller = activeExecutions.get(planID)
    if (controller) {
      controller.abort()
      activeExecutions.delete(planID)
    }
    await PlanStore.transition({ id: planID, status: "failed" })
    const plan = await PlanStore.get(planID)
    await Recovery.cleanupWorktrees(plan)
    log.info("plan cancelled", { planID })
  })

  export async function retry(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)
    if (plan.status !== "failed") {
      throw new Error("Can only retry failed plans")
    }

    await PlanStore.transition({ id: planID, status: "draft" })

    // Preserve existing model overrides from current subtasks
    const modelOverrides = new Map<string, ModelRef>()
    for (const st of plan.subtasks) {
      if (st.model) {
        // Index by title since IDs change on regeneration
        modelOverrides.set(st.title, st.model)
      }
    }

    const codebaseContext = await Decomposition.gatherCodebaseContext(Instance.directory)
    const formattedContext = Decomposition.formatCodebaseContext(codebaseContext)

    const subtasks = await Decomposition.decompose({
      task: plan.task,
      model: plan.orchestratorModel,
      codebaseContext: formattedContext,
    })

    // Restore model overrides where titles match
    const restoredSubtasks = subtasks.map((st) => {
      const override = modelOverrides.get(st.title)
      return override ? { ...st, model: override } : st
    })

    return PlanStore.update({
      id: planID,
      subtasks: restoredSubtasks,
      workers: restoredSubtasks.map((st) => ({
        subtaskID: st.id,
        status: "pending" as const,
      })),
      status: "proposed",
    })
  }

  export const retryWorker = fn(
    z.object({
      planID: PlanIDSchema.zod,
      subtaskID: SubtaskIDSchema.zod,
    }),
    async ({ planID, subtaskID }): Promise<Plan> => {
      const plan = await PlanStore.get(planID)
      const worker = plan.workers.find((w) => w.subtaskID === subtaskID)

      if (!worker) {
        throw new Error(`Worker not found for subtask: ${subtaskID}`)
      }

      if (worker.status !== "failed") {
        throw new Error(`Cannot retry worker with status '${worker.status}'. Only failed workers can be retried.`)
      }

      const subtask = plan.subtasks.find((st) => st.id === subtaskID)
      if (!subtask) {
        throw new Error(`Subtask not found: ${subtaskID}`)
      }

      await PlanStore.updateWorker({
        id: planID,
        subtaskID,
        status: "pending",
        error: undefined,
        sessionID: undefined,
        worktreeName: undefined,
        worktreeDir: undefined,
        branch: undefined,
        diffStat: undefined,
      })

      const controller = new AbortController()

      WorkerManager.spawnOne(plan, subtask, controller.signal)
        .then(async () => {
          await WorkerManager.waitAll(planID, controller.signal)

          const updated = await PlanStore.get(planID)
          const allDone = updated.workers.every((w) => w.status === "done" || w.status === "merged")
          const hasFailures = updated.workers.some((w) => w.status === "failed")

          if (allDone && !hasFailures && updated.status === "running") {
            await PlanStore.transition({ id: planID, status: "merging" })
            await PlanStore.transition({ id: planID, status: "integrating" })
            const integrationResult = await Integration.integrate(planID)

            if (integrationResult.merged.length === 0) {
              await PlanStore.transition({ id: planID, status: "failed" })
              const finalPlan = await PlanStore.get(planID)
              await Recovery.cleanupWorktrees(finalPlan)
              return
            }

            await PlanStore.transition({ id: planID, status: "integrated" })

            const cfg = await Config.get()
            const plan = await PlanStore.get(planID)
            const publishMode = plan.publishMode ?? cfg.parallel?.publish_mode ?? "new-branch"
            await PlanStore.transition({ id: planID, status: "publishing" })
            const publishResult = await Integration.publish(planID, publishMode)

            const finalPlan = await PlanStore.get(planID)
            const outcome = resolveOutcome({
              workers: finalPlan.workers,
              integrationSuccess: integrationResult.success,
              publishSuccess: publishResult.success,
            })
            const finalStatus = outcome.status
            await PlanStore.transition({ id: planID, status: finalStatus })

            if (finalStatus === "failed" && outcome.unresolved === 0) {
              await Recovery.cleanupWorktrees(finalPlan)
            }
          }
        })
        .catch(async (error) => {
          log.error("worker retry failed", { planID, subtaskID, error })
          await PlanStore.updateWorker({
            id: planID,
            subtaskID,
            status: "failed",
            error: error instanceof Error ? error.message : "Retry failed",
          }).catch(() => {})
        })

      log.info("worker retry initiated", { planID, subtaskID })
      return PlanStore.get(planID)
    },
  )

  export async function publish(planID: PlanID, opts: { mode: "new-branch" | "unstaged" | "direct" }): Promise<void> {
    const plan = await PlanStore.get(planID)
    const cfg = await Config.get()
    const mode = opts.mode ?? plan.publishMode ?? cfg.parallel?.publish_mode ?? "new-branch"

    log.info("publishing plan", { planID, mode })

    const result = await Integration.publish(planID, mode)
    if (plan.status === "integrated" && result.success) {
      await PlanStore.transition({ id: planID, status: "done" })
    }
  }
}
