import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Orchestrator } from "@/parallel/orchestrator"
import { Decomposition } from "@/parallel/decomposition"
import { SubtaskID } from "@/parallel/schema"
import { Instance } from "@/project/instance"
import type { Subtask } from "@/parallel/schema"
import { Config } from "@/config/config"

const SubtaskModelSchema = z.object({
  providerID: z.string().describe("Provider ID (e.g., 'anthropic')"),
  modelID: z.string().describe("Model ID (e.g., 'claude-sonnet-4-20250514')"),
})

const SharedContractSchema = z.object({
  name: z.string().describe("Short name for the shared contract"),
  description: z.string().describe("What the contract covers"),
  types: z.string().describe("Exact type definitions or API shape both sides must follow"),
  producerIndices: z
    .array(z.number().int().nonnegative())
    .describe("0-based subtask indices that produce or define this contract"),
  consumerIndices: z
    .array(z.number().int().nonnegative())
    .describe("0-based subtask indices that consume this contract"),
})

const ConventionsSchema = z.object({
  serialization: z.string().optional().describe("Shared serialization format or response shape"),
  auth: z.string().optional().describe("Auth scheme all workers must follow"),
  timestamps: z.string().optional().describe("Timestamp storage and formatting rules"),
  naming: z.string().optional().describe("Shared naming conventions"),
  other: z.array(z.string()).optional().describe("Other cross-cutting conventions"),
})

const ParamsSchema = z.object({
  task: z.string().describe("Overall task description"),
  replace: z
    .boolean()
    .optional()
    .describe("When true, completely replace existing subtasks instead of updating. Use for plan regeneration."),
  subtasks: z
    .array(
      z.object({
        title: z.string().describe("Short title for this subtask"),
        description: z.string().describe("Detailed instructions for the worker agent"),
        fileScope: z
          .array(z.string())
          .describe("Files this subtask will create or modify. Must not overlap with other subtasks."),
        dependencies: z
          .array(z.number().int().nonnegative())
          .optional()
          .describe("0-based indices of subtasks that must complete before this one can start."),
        constraints: z
          .array(z.string())
          .optional()
          .describe("Negative constraints for this subtask, such as forbidden files, libs, or behaviors."),
        kind: z
          .enum(["semantic", "structural"])
          .optional()
          .describe("Use structural for mechanical refactors, semantic for behavior or feature work."),
        model: SubtaskModelSchema.optional().describe(
          "Optional model override for this subtask. If not specified, uses the plan's worker model.",
        ),
      }),
    )
    .describe("List of subtasks in the execution graph"),
  sharedContracts: z
    .array(SharedContractSchema)
    .optional()
    .describe("Optional producer/consumer contracts shared across subtasks."),
  conventions: ConventionsSchema.optional().describe("Optional project-wide conventions for all workers."),
})
type Params = z.infer<typeof ParamsSchema>

export const ParallelPlanTool = Tool.define("parallel_plan", async (initCtx) => {
  const current = initCtx?.agent?.model

  return {
    description:
      "Create or update a parallel execution plan. Call this to propose a full execution DAG across isolated git worktrees. Subtasks may depend on earlier subtasks, and the runtime will unlock later waves automatically. If a plan already exists for this project, it will be updated.",
    parameters: ParamsSchema,
    async execute(params: Params, ctx) {
      const models = await Orchestrator.resolveModels({ currentModel: current })
      const projectID = Instance.project.id
      const cfg = await Config.get()
      const approvalMode = cfg.parallel?.approval_mode ?? "plan"

      // Find existing draft/proposed plan for this project+session (session-scoped to prevent cross-session overwrites)
      const plans = await PlanStore.list()
      const existing = params.replace
        ? null // When replace is true, always create new
        : plans.find(
            (p) =>
              p.projectID === projectID &&
              p.sessionID === ctx.sessionID &&
              (p.status === "draft" || p.status === "proposed"),
          )

      const depError = Decomposition.validateDependencies(params.subtasks.map((st) => ({ dependencies: st.dependencies ?? [] })))
      if (depError) {
        throw new Error(`Invalid subtask dependencies at index ${depError.subtaskIndex}: ${depError.details}`)
      }

      const ids = params.subtasks.map(() => SubtaskID.ascending())
      const subtasks: Subtask[] = params.subtasks.map((st, i) => ({
        id: ids[i],
        title: st.title,
        description: st.description,
        fileScope: st.fileScope,
        dependencies: [...new Set((st.dependencies ?? []).map((dep) => ids[dep]))],
        constraints: st.constraints,
        kind: st.kind,
        model: st.model
          ? {
              modelID: st.model.modelID as any,
              providerID: st.model.providerID as any,
            }
          : undefined,
      }))

      const sharedContracts = params.sharedContracts?.map((item) => ({
        name: item.name,
        description: item.description,
        types: item.types,
        producers: [...new Set(item.producerIndices.map((idx) => ids[idx]))],
        consumers: [...new Set(item.consumerIndices.map((idx) => ids[idx]))],
      }))

      const workers = subtasks.map((st) => ({
        subtaskID: st.id,
        status: "pending" as const,
      }))

      let plan
      if (existing) {
        plan = await PlanStore.update({
          id: existing.id,
          subtasks,
          workers,
          sharedContracts: sharedContracts ?? existing.sharedContracts ?? null,
          conventions: params.conventions ?? existing.conventions ?? null,
          ...(existing.status === "draft" ? { status: "proposed" } : {}),
        })
      } else {
        const created = await PlanStore.create({
          projectID,
          sessionID: ctx.sessionID,
          task: params.task,
          ...models,
          approvalMode,
        })
        plan = await PlanStore.update({
          id: created.id,
          subtasks,
          workers,
          sharedContracts: sharedContracts ?? null,
          conventions: params.conventions ?? null,
          status: "proposed",
        })
      }

      const summary = subtasks
        .map((st, i) => {
          const modelInfo = st.model ? ` [${st.model.modelID}]` : ""
          const deps = st.dependencies.length
            ? ` | depends on: ${st.dependencies.map((dep) => subtasks.findIndex((item) => item.id === dep) + 1).join(", ")}`
            : ""
          return `${i + 1}. **${st.title}**${modelInfo} — ${st.fileScope.length} file(s): ${st.fileScope.join(", ")}${deps}`
        })
        .join("\n")

      const extras = [
        sharedContracts?.length ? `Shared contracts: ${sharedContracts.length}` : "",
        params.conventions ? "Project conventions: yes" : "",
      ]
        .filter(Boolean)
        .join("\n")

      return {
        title: `Plan ${existing ? "updated" : "created"} with ${subtasks.length} subtasks`,
        output: `Plan ID: ${plan.id}\nStatus: ${plan.status}\n\n${summary}${extras ? `\n\n${extras}` : ""}\n\nThe user can now review and refine. When ready, call parallel_execute to launch the full dependency-aware plan.`,
        metadata: { planID: plan.id },
      }
    }
  }
})
