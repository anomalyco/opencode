import { Bus } from "@/bus"
import { TeamMainPlan } from "@/team/main-plan"
import { Tool } from "../shared/tool"
import { blank, seen } from "../shared/shape"
import { pct } from "../shared/team-tools"
import z from "zod"

const DESCRIPTION = `Atlas-only main-plan follow tool for inspecting execution-facing main-plan state and updating task tracking without routing through the planning subagent.

Use this tool when ATLAS needs to follow an existing main plan directly, inspect execution-facing plan state, or update linked task tracking while keeping strategic plan authoring and replanning inside \`niggli\`.

Actions:
- \`list\`: list current plans with readiness and progress summary
- \`get\`: read one plan with execution-oriented JSON content only
- \`update_task\`: update execution tracking for one task and refresh derived stats`

const id = "atlas-plan-follow"
const Action = z.enum(["list", "get", "update_task"])

const parameters = z
  .object({
    action: Action.default("list"),
    plan_id: z.preprocess(blank, TeamMainPlan.PlanID.optional()).describe("The plan id for get and update_task actions."),
    phase_id: z.preprocess(blank, z.string().optional()).describe("Phase id for update_task."),
    task_id: z.preprocess(blank, z.string().optional()).describe("Task id for update_task."),
    status: TeamMainPlan.TaskStatus.optional().describe("Execution status for the task."),
    done: z.boolean().optional().describe("Whether the task is complete."),
    objective: z.number().min(0).max(1).optional().describe("0-1 objective coverage for the task."),
    tests: z.number().min(0).max(1).optional().describe("0-1 test completion for the task."),
    summary: z.preprocess(blank, z.string().optional()).describe("Summary of completed work for the task."),
    risks: z.array(z.string()).optional().describe("Remaining task risks."),
    blockers: z.array(z.string()).optional().describe("Concrete blockers keeping the task from progressing."),
    evidence: z.array(z.string()).optional().describe("Evidence or artifacts proving task progress or completion."),
    affected_files: z.array(z.string()).optional().describe("Files affected by the task work."),
  })
  .strict()
  .superRefine((input, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(input[key as keyof typeof input])) continue
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when action=${input.action}` })
      }
    }
    const drop = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(input[key as keyof typeof input])) continue
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is not allowed when action=${input.action}` })
      }
    }

    if (input.action === "list") {
      drop([
        "plan_id",
        "phase_id",
        "task_id",
        "status",
        "done",
        "objective",
        "tests",
        "summary",
        "risks",
        "blockers",
        "evidence",
        "affected_files",
      ])
      return
    }

    if (input.action === "get") {
      need(["plan_id"])
      drop([
        "phase_id",
        "task_id",
        "status",
        "done",
        "objective",
        "tests",
        "summary",
        "risks",
        "blockers",
        "evidence",
        "affected_files",
      ])
      return
    }

    need(["plan_id", "phase_id", "task_id"])
    if (
      input.status === undefined &&
      input.done === undefined &&
      input.objective === undefined &&
      input.tests === undefined &&
      input.summary === undefined &&
      input.risks === undefined &&
      input.blockers === undefined &&
      input.evidence === undefined &&
      input.affected_files === undefined
    ) {
      ctx.addIssue({ code: "custom", path: ["action"], message: "update_task requires at least one task field" })
    }
  })

type Metadata = {
  plan_id?: string
  file?: string
  change?: string
  tracking?: TeamMainPlan.Stats
  count?: number
  plans?: {
    plan_id: string
    title: string
    progress: number
    objective: number
    tests: number
    open_questions: number
    ready_for_execution: boolean
    readiness_issues: number
    updated_at: number
  }[]
}

function execution(plan: TeamMainPlan.Plan) {
  const issues = TeamMainPlan.readiness_issues(plan)
  return {
    plan_id: plan.id,
    title: plan.title,
    handoff: plan.handoff,
    stats: plan.stats,
    open_questions: TeamMainPlan.open_draft_questions(plan),
    ready_for_execution: issues.length === 0,
    readiness_issues: issues,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      order: phase.order,
      title: phase.title,
      context: phase.context,
      parallel: phase.parallel,
      depends_on: phase.depends_on,
      exit_conditions: phase.exit_conditions,
      stats: phase.stats,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        order: task.order,
        title: task.title,
        kind: task.kind,
        lane: task.lane,
        feature: task.feature,
        details: task.details,
        suggested_files: task.suggested_files,
        checkpoints: task.checkpoints,
        parallel: task.parallel,
        depends_on: task.depends_on,
        score: task.score,
        state: task.state,
        stats: task.stats,
      })),
    })),
  }
}

function info(plan: TeamMainPlan.Plan, file: string) {
  const open = TeamMainPlan.open_draft_questions(plan)
  const issues = TeamMainPlan.readiness_issues(plan)
  return [
    `plan_id: ${plan.id}`,
    `file: ${TeamMainPlan.relative(file)}`,
    `title: ${plan.title}`,
    `handoff_route: ${plan.handoff.route}`,
    `handoff_summary: ${plan.handoff.summary}`,
    `phases: ${plan.stats.phase_total}`,
    `tasks: ${plan.stats.task_total}`,
    `open_questions: ${open}`,
    `ready_for_execution: ${issues.length === 0 ? "yes" : "no"}`,
    `readiness_issues: ${issues.length}`,
    ...issues.slice(0, 5).map((item, i) => `readiness_issue_${i + 1}: ${item}`),
    `score: ${plan.stats.score_done}/${plan.stats.score_total}`,
    `progress: ${pct(plan.stats.progress)}`,
    `objective: ${pct(plan.stats.objective)}`,
    `tests: ${pct(plan.stats.tests)}`,
    `updated_at: ${new Date(plan.time.updated).toISOString()}`,
  ].join("\n")
}

export const AtlasPlanFollowTool = Tool.define<typeof parameters, Metadata>(id, {
  description: DESCRIPTION,
  parameters,
  async execute(input, ctx) {
    await ctx.ask({
      permission: id,
      patterns: [input.action],
      always: [input.action],
      metadata: {
        action: input.action,
        plan_id: input.plan_id,
      },
    })

    if (input.action === "list") {
      const list = await TeamMainPlan.list()
      const metadata = {
        count: list.length,
        plans: list.map((plan) => ({
          plan_id: plan.id,
          title: plan.title,
          progress: plan.stats.progress,
          objective: plan.stats.objective,
          tests: plan.stats.tests,
          open_questions: TeamMainPlan.open_draft_questions(plan),
          ready_for_execution: TeamMainPlan.is_ready_for_execution(plan),
          readiness_issues: TeamMainPlan.readiness_issues(plan).length,
          updated_at: plan.time.updated,
        })),
      }
      ctx.metadata({ title: `atlas main plans (${list.length})`, metadata })
      return {
        title: `atlas main plans (${list.length})`,
        metadata,
        output:
          list.length === 0
            ? "count: 0"
            : [
                `count: ${list.length}`,
                ...list.flatMap((plan) => [
                  "",
                  `plan_id: ${plan.id}`,
                  `title: ${plan.title}`,
                  `progress: ${pct(plan.stats.progress)}`,
                  `objective: ${pct(plan.stats.objective)}`,
                  `tests: ${pct(plan.stats.tests)}`,
                  `open_questions: ${TeamMainPlan.open_draft_questions(plan)}`,
                  `ready_for_execution: ${TeamMainPlan.is_ready_for_execution(plan) ? "yes" : "no"}`,
                  `readiness_issues: ${TeamMainPlan.readiness_issues(plan).length}`,
                  `updated_at: ${new Date(plan.time.updated).toISOString()}`,
                ]),
              ].join("\n"),
      }
    }

    if (input.action === "get") {
      const plan = await TeamMainPlan.get(input.plan_id!)
      const file = TeamMainPlan.file(plan.id)
      const metadata = {
        plan_id: plan.id,
        file: TeamMainPlan.relative(file),
        tracking: plan.stats,
      }
      ctx.metadata({ title: plan.title, metadata })
      return {
        title: plan.title,
        metadata,
        output: [info(plan, file), "", "<plan_execution_json>", JSON.stringify(execution(plan), null, 2), "</plan_execution_json>"].join("\n"),
      }
    }

    const item = await TeamMainPlan.update_task({
      plan_id: input.plan_id!,
      phase_id: input.phase_id!,
      task_id: input.task_id!,
      state: {
        status: input.status,
        done: input.done,
        objective: input.objective,
        tests: input.tests,
        summary: input.summary,
        risks: input.risks,
        blockers: input.blockers,
        evidence: input.evidence,
        affected_files: input.affected_files,
      },
    })
    await Bus.publish(TeamMainPlan.Event.Updated, {
      change: "task_updated",
      ...item,
    })
    const phase = item.plan.phases.find((row) => row.id === input.phase_id!)
    const task = phase?.tasks.find((row) => row.id === input.task_id!)
    const metadata = {
      plan_id: item.plan.id,
      file: TeamMainPlan.relative(item.file),
      change: "task_updated",
      tracking: item.plan.stats,
    }
    ctx.metadata({ title: task?.title ?? item.plan.title, metadata })
    return {
      title: task?.title ?? item.plan.title,
      metadata,
      output: [
        info(item.plan, item.file),
        "",
        `phase_id: ${input.phase_id}`,
        `task_id: ${input.task_id}`,
        task ? `task_status: ${task.state.status}` : undefined,
        task ? `task_progress: ${pct(task.stats.progress)}` : undefined,
        task ? `task_objective: ${pct(task.stats.objective)}` : undefined,
        task ? `task_tests: ${pct(task.stats.tests)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    }
  },
})
