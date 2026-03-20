import { PlanStore } from "./plan"
import { Decomposition } from "./decomposition"
import { WorkerManager } from "./worker"
import { MergePipeline } from "./merge"
import { Recovery } from "./recovery"
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

  function text(err: unknown): string {
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
    const code = err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : "unknown"
    const stage = err instanceof Error && "stage" in err && typeof err.stage === "string" ? err.stage : "unknown"
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

    const ids = new Set(plan.subtasks.map((subtask) => subtask.id))
    for (const subtask of plan.subtasks) {
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
      ...plan.subtasks.flatMap((subtask) => (subtask.model ? [subtask.model] : [])),
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
    const graph = new Map(plan.subtasks.map((subtask) => [String(subtask.id), subtask.dependencies.map(String)]))
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
    const running = [...active, ...spawning, ...merging]

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
    }),
    async (input): Promise<Plan> => {
      await checkPlanLimit(input.projectID)
      await checkRunningPlan(input.projectID)

      const models = await resolveModels({
        orchestratorModel: input.orchestratorModel,
        workerModel: input.workerModel,
      })

      const plan = await PlanStore.create({
        projectID: input.projectID,
        sessionID: input.sessionID,
        task: input.task,
        ...models,
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

      const cfg = await Config.get()
      const autoApprove = cfg.parallel?.require_approval === false
      if (autoApprove) {
        await approve(updated.id)
      }

      log.info("plan created", { planID: plan.id, subtaskCount: subtasks.length, autoApprove })
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

    await PlanStore.transition({ id: planID, status: "merging" })
    const mergeSuccess = await stage("merging", () => MergePipeline.run(planID))

    // Determine final status based on worker outcomes
    const finalPlan = await PlanStore.get(planID)
    const mergedWorkers = finalPlan.workers.filter((w) => w.status === "merged")
    const failedWorkers = finalPlan.workers.filter((w) => w.status === "failed" || w.status === "conflict")

    let finalStatus: "done" | "partial_success" | "failed"
    if (mergeSuccess && failedWorkers.length === 0) {
      finalStatus = "done"
    } else if (mergedWorkers.length > 0) {
      finalStatus = "partial_success"
      log.info("plan partial success", {
        planID,
        merged: mergedWorkers.length,
        failed: failedWorkers.length,
      })
    } else {
      finalStatus = "failed"
    }

    await PlanStore.transition({ id: planID, status: finalStatus })
    Metrics.recordPlanOutcome(finalStatus)

    if (finalStatus === "failed") {
      await Recovery.cleanupWorktrees(finalPlan)
    }

    log.info("plan execution complete", { planID, status: finalStatus })
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
            const success = await MergePipeline.run(planID)
            await PlanStore.transition({ id: planID, status: success ? "done" : "failed" })
            if (!success) {
              const finalPlan = await PlanStore.get(planID)
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
}
