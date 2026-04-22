import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Question } from "@/question"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TeamMainPlan } from "@/team/main-plan"
import { Tool } from "../shared/tool"
import { blank } from "../shared/shape"
import { pct } from "../shared/team-tools"
import z from "zod"

const DESCRIPTION = `Create, inspect, revise, archive, and track durable JSON strategic plans under \`~/.config/opencode/projects/<project_id>/main-plan\`.

Use this tool when \`niggli\` needs to create or update a durable main plan record, ask caller-facing clarification questions that store answers on the plan, archive a superseded plan, or update execution tracking fields for a planned task.

Purpose:
- Keep the strategic plan in one durable structured record instead of scattered free-form prose
- Preserve planning context, clarification history, execution partition, handoff intent, and tracking state in one model
- Give ATLAS and other plan-aware tooling a stable plan surface they can inspect directly

Stored plan content:
- top-level planning context: \`title\`, \`prompt.raw\`, \`prompt.meta\`, \`goal\`, \`scope\`, \`target\`
- ownership and question routing context: \`owner.agent\`, \`owner.session_id\`, \`owner.message_id\`, \`owner.question_session_id\`, \`owner.caller_session_id\`
- draft planning memory: \`draft.notes\`
- caller-facing draft clarification questions and answers: \`draft.questions\`
- structured execution handoff: \`handoff.route\`, \`handoff.summary\`
- execution partition: \`phases\`, \`tasks\`, explicit \`order\`, \`lane\`, \`parallel\`, \`depends_on\`, \`details\`, \`checkpoints\`, \`suggested_files\`, \`feature\`, \`score\`
- execution tracking: task \`state.status\`, \`done\`, \`objective\`, \`tests\`, \`summary\`, \`risks\`, \`blockers\`, \`evidence\`, \`affected_files\`, plus derived phase/task/plan \`stats\`
- translation and UI helper fields: \`*_ui\`, \`ui_locale\`, \`translate_*\`

Key behaviors:
- Stores multiple current or archived plans as JSON files under \`~/.config/opencode/projects/<project_id>/main-plan\`
- Persists meta-prompted request context, draft notes, goal, scope, target, and plan ownership
- Keeps phases and detailed tasks with dependencies, checkpoints, suggested files, and scoring
- Auto-fills stable phase/task ordering when callers omit explicit \`order\`
- Stores structured execution handoff data such as the recommended route and handoff summary
- Automatically recalculates derived phase and plan tracking totals and percentages
- Computes readiness diagnostics so planners and followers can see why a plan is or is not execution-ready
- Supports draft questions that use question-tool-compatible inputs, surface in the caller session, and store the answers on the plan
- Supports plan lifecycle archiving for superseded strategic plans without destructive deletion

Actions:
- \`create\`: create a new plan JSON file
- \`list\`: list saved plans for the current project; optionally switch to archived plans and filter by caller question session or planner owner session
- \`get\`: read one plan, including the full stored JSON payload
- \`set\`: update top-level plan fields and structured handoff fields; phase/task structure replacement is allowed only with an explicit \`replace_phases=true\` flag and still preserves tracked task state when possible. Updating through \`set\` also revives the plan into the active list by clearing any archived timestamp.
- \`archive\`: mark one plan archived so it drops out of the active plan list
- \`draft_question\`: ask and record draft questions using question-tool-compatible inputs; the question appears in the caller session and the answers are stored on the plan
- \`update_task\`: update execution tracking for one task (\`status\`, progress, blockers, evidence, summary, risks, affected files) and refresh derived stats

Usage guidance:
- Use \`draft_question\` whenever real caller input is required; do not leave caller-blocking issues only in \`draft.notes\`
- Keep execution partition explicit in \`phases\`, \`tasks\`, \`parallel\`, \`depends_on\`, \`details\`, and \`checkpoints\` instead of burying it in prose
- Use \`lane\`, \`order\`, dependencies, and checkpoints to make the execution route inspectable without hidden planner context
- Do not pass \`phases\` through \`set\` unless you intentionally mean to replace the stored plan structure; when you do, set \`replace_phases=true\`
- Keep \`handoff.route\` and \`handoff.summary\` populated when the execution handoff is known
- Use \`archive\` for superseded plans instead of destructive deletion
- Use \`list\` filters when you need to narrow plans to the current caller session or a specific planner-owned session family
- Use \`update_task\` only for execution tracking state, not for reshaping the strategic plan itself
- Treat \`ready_for_execution\` together with the surfaced readiness issues; a \`no\` should be actionable from the stored diagnostics`

const id = "main-plan"
const Action = z.enum(["create", "list", "get", "set", "archive", "draft_question", "update_task"])
const draft_question = Question.Prompt.zod

const parameters = z
  .object({
    action: Action.default("list"),
    plan_id: z.preprocess(blank, TeamMainPlan.PlanID.optional()).describe(
      "The plan id for get, set, archive, draft_question, and update_task actions.",
    ),
    title: z.string().optional().describe("Short plan title for create or set."),
    raw_prompt: z.string().optional().describe("Optional raw user prompt before meta prompting."),
    meta_prompt: z.string().optional().describe("Meta-prompted user request to store on the plan."),
    draft_notes: z.string().optional().describe("Planning notes stored in the draft area."),
    goal: z.string().optional().describe("Plan goal string."),
    scope: z.string().optional().describe("Plan scope string."),
    target: z.string().optional().describe("Plan target string."),
    handoff_route: z.string().optional().describe("Structured execution route recommendation for the plan handoff."),
    handoff_summary: z.string().optional().describe("Structured execution handoff summary for the plan."),
    phases: z.array(TeamMainPlan.PhaseInput).optional().describe("Plan phases with detailed tasks."),
    replace_phases: z
      .boolean()
      .optional()
      .describe("Require true when set should intentionally replace stored phases/tasks."),
    questions: z.array(draft_question).optional().describe("Draft questions to ask and store on the plan."),
    archived: z.boolean().optional().describe("Whether list should return archived plans instead of active plans."),
    session_id: z.string().optional().describe("Optional caller question-session filter for list."),
    owner_session_id: z.string().optional().describe("Optional planner owner-session filter for list."),
    phase_id: z.string().optional().describe("Phase id for update_task."),
    task_id: z.string().optional().describe("Task id for update_task."),
    status: TeamMainPlan.TaskStatus.optional().describe("Execution status for the task."),
    done: z.boolean().optional().describe("Whether the task is complete."),
    objective: z.number().min(0).max(1).optional().describe("0-1 objective coverage for the task."),
    tests: z.number().min(0).max(1).optional().describe("0-1 test completion for the task."),
    summary: z.string().optional().describe("Summary of completed work for the task."),
    risks: z.array(z.string()).optional().describe("Remaining task risks."),
    blockers: z.array(z.string()).optional().describe("Concrete blockers keeping the task from progressing."),
    evidence: z.array(z.string()).optional().describe("Evidence or artifacts proving task progress or completion."),
    affected_files: z.array(z.string()).optional().describe("Files affected by the task work."),
  })
  .superRefine((input, ctx) => {
    if (input.action === "create") {
      if (!input.meta_prompt)
        ctx.addIssue({ code: "custom", path: ["meta_prompt"], message: "meta_prompt is required" })
      if (!input.goal) ctx.addIssue({ code: "custom", path: ["goal"], message: "goal is required" })
      if (!input.scope) ctx.addIssue({ code: "custom", path: ["scope"], message: "scope is required" })
      if (!input.target) ctx.addIssue({ code: "custom", path: ["target"], message: "target is required" })
      return
    }

    if (input.action === "get" || input.action === "archive" || input.action === "draft_question") {
      if (!input.plan_id) ctx.addIssue({ code: "custom", path: ["plan_id"], message: "plan_id is required" })
    }

    if (input.action === "set") {
      if (!input.plan_id) ctx.addIssue({ code: "custom", path: ["plan_id"], message: "plan_id is required" })
      if (
        input.title === undefined &&
        input.raw_prompt === undefined &&
        input.meta_prompt === undefined &&
        input.draft_notes === undefined &&
        input.goal === undefined &&
        input.scope === undefined &&
        input.target === undefined &&
        input.handoff_route === undefined &&
        input.handoff_summary === undefined &&
        input.phases === undefined
      ) {
        ctx.addIssue({ code: "custom", path: ["action"], message: "set requires at least one field to update" })
      }
      if (input.phases !== undefined && input.replace_phases !== true) {
        ctx.addIssue({
          code: "custom",
          path: ["replace_phases"],
          message: "replace_phases=true is required when set updates phases",
        })
      }
      if (input.replace_phases !== undefined && input.phases === undefined) {
        ctx.addIssue({ code: "custom", path: ["phases"], message: "phases are required when replace_phases is set" })
      }
      return
    }

    if (input.action === "archive") return

    if (input.action === "draft_question") {
      if (!input.questions?.length)
        ctx.addIssue({ code: "custom", path: ["questions"], message: "questions are required" })
      return
    }

    if (input.action === "update_task") {
      if (!input.plan_id) ctx.addIssue({ code: "custom", path: ["plan_id"], message: "plan_id is required" })
      if (!input.phase_id) ctx.addIssue({ code: "custom", path: ["phase_id"], message: "phase_id is required" })
      if (!input.task_id) ctx.addIssue({ code: "custom", path: ["task_id"], message: "task_id is required" })
      if (
        input.done === undefined &&
        input.objective === undefined &&
        input.tests === undefined &&
        input.summary === undefined &&
        input.risks === undefined &&
        input.blockers === undefined &&
        input.evidence === undefined &&
        input.status === undefined &&
        input.affected_files === undefined
      ) {
        ctx.addIssue({ code: "custom", path: ["action"], message: "update_task requires at least one task field" })
      }
    }
  })

type Metadata = {
  plan_id?: string
  file?: string
  change?: string
  tracking?: TeamMainPlan.Stats
  question_session_id?: SessionID
  count?: number
  plan?: TeamMainPlan.Plan
  plans?: {
    plan_id: string
    title: string
    open_questions: number
    ready_for_execution: boolean
    readiness_issues: number
    progress: number
    objective: number
    tests: number
    updated_at: number
  }[]
}

function info(plan: TeamMainPlan.Plan, file: string) {
  const open = TeamMainPlan.open_draft_questions(plan)
  const issues = TeamMainPlan.readiness_issues(plan)
  return [
    `plan_id: ${plan.id}`,
    `file: ${TeamMainPlan.relative(file)}`,
    `title: ${plan.title}`,
    `goal: ${plan.goal}`,
    `scope: ${plan.scope}`,
    `target: ${plan.target}`,
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

function answers(list: ReadonlyArray<ReadonlyArray<string>>, items: z.infer<typeof draft_question>[]) {
  return items
    .map((item, i) => `"${item.question}"="${list[i]?.length ? list[i].join(", ") : "Unanswered"}"`)
    .join(", ")
}

async function parent(id: SessionID) {
  const session = await Session.get(id)
  return session.parentID ?? id
}

export const MainPlanTool = Tool.define<typeof parameters, Metadata>(id, {
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
        title: input.title,
      },
    })

    if (input.action === "list") {
      const list = await TeamMainPlan.list({
        archived: input.archived ?? false,
        session_id: input.session_id,
        owner_session_id: input.owner_session_id,
      })
      const metadata = {
        count: list.length,
        plans: list.map((plan) => ({
          plan_id: plan.id,
          title: plan.title,
          open_questions: TeamMainPlan.open_draft_questions(plan),
          ready_for_execution: TeamMainPlan.is_ready_for_execution(plan),
          readiness_issues: TeamMainPlan.readiness_issues(plan).length,
          progress: plan.stats.progress,
          objective: plan.stats.objective,
          tests: plan.stats.tests,
          updated_at: plan.time.updated,
        })),
      }
      ctx.metadata({
        title: `main plans (${list.length})`,
        metadata,
      })
      return {
        title: `main plans (${list.length})`,
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
                  `open_questions: ${TeamMainPlan.open_draft_questions(plan)}`,
                  `ready_for_execution: ${TeamMainPlan.is_ready_for_execution(plan) ? "yes" : "no"}`,
                  `readiness_issues: ${TeamMainPlan.readiness_issues(plan).length}`,
                  `progress: ${pct(plan.stats.progress)}`,
                  `score: ${plan.stats.score_done}/${plan.stats.score_total}`,
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
        question_session_id: plan.owner.question_session_id,
        plan,
      }
      ctx.metadata({ title: plan.title, metadata })
      return {
        title: plan.title,
        metadata,
        output: [info(plan, file), "", "<plan_json>", JSON.stringify(plan, null, 2), "</plan_json>"].join("\n"),
      }
    }

    if (input.action === "create") {
      const ask = await parent(ctx.sessionID)
      const item = await TeamMainPlan.create({
        title: input.title,
        prompt: {
          raw: input.raw_prompt,
          meta: input.meta_prompt!,
        },
        owner: {
          agent: ctx.agent,
          session_id: ctx.sessionID,
          message_id: ctx.messageID,
          call_id: ctx.callID,
          question_session_id: ask,
          caller_session_id: ask === ctx.sessionID ? undefined : ask,
        },
        draft: {
          notes: input.draft_notes ?? "",
          questions: [],
        },
        handoff:
          input.handoff_route !== undefined || input.handoff_summary !== undefined
            ? {
                route: input.handoff_route ?? "",
                summary: input.handoff_summary ?? "",
              }
            : undefined,
        goal: input.goal!,
        scope: input.scope!,
        target: input.target!,
        phases: input.phases,
      })
      await Bus.publish(TeamMainPlan.Event.Created, item)
      const metadata = {
        plan_id: item.plan.id,
        file: TeamMainPlan.relative(item.file),
        change: "create",
        tracking: item.plan.stats,
        question_session_id: ask,
        plan: item.plan,
      }
      ctx.metadata({ title: item.plan.title, metadata })
      return {
        title: item.plan.title,
        metadata,
        output: [info(item.plan, item.file), "", `question_session_id: ${ask}`].join("\n"),
      }
    }

    if (input.action === "set") {
      const item = await TeamMainPlan.update(input.plan_id!, (plan) => ({
        ...plan,
        title: input.title ?? plan.title,
        prompt: {
          raw: input.raw_prompt ?? plan.prompt.raw,
          meta: input.meta_prompt ?? plan.prompt.meta,
        },
        draft: {
          ...plan.draft,
          notes: input.draft_notes ?? plan.draft.notes,
        },
        handoff: {
          route: input.handoff_route ?? plan.handoff.route,
          summary: input.handoff_summary ?? plan.handoff.summary,
        },
        goal: input.goal ?? plan.goal,
        scope: input.scope ?? plan.scope,
        target: input.target ?? plan.target,
        phases: input.replace_phases === true ? TeamMainPlan.preserve_phases(plan.phases, input.phases) : plan.phases,
        time: {
          ...plan.time,
          archived: undefined,
        },
      }))
      await Bus.publish(TeamMainPlan.Event.Updated, {
        change: "set",
        ...item,
      })
      const metadata = {
        plan_id: item.plan.id,
        file: TeamMainPlan.relative(item.file),
        change: "set",
        tracking: item.plan.stats,
        question_session_id: item.plan.owner.question_session_id,
        plan: item.plan,
      }
      ctx.metadata({ title: item.plan.title, metadata })
      return {
        title: item.plan.title,
        metadata,
        output: info(item.plan, item.file),
      }
    }

    if (input.action === "archive") {
      const item = await TeamMainPlan.archive({ plan_id: input.plan_id! })
      await Bus.publish(TeamMainPlan.Event.Updated, {
        change: "archived",
        ...item,
      })
      const metadata = {
        plan_id: item.plan.id,
        file: TeamMainPlan.relative(item.file),
        change: "archived",
        tracking: item.plan.stats,
        question_session_id: item.plan.owner.question_session_id,
        plan: item.plan,
      }
      ctx.metadata({ title: item.plan.title, metadata })
      return {
        title: item.plan.title,
        metadata,
        output: [
          info(item.plan, item.file),
          "",
          `archived_at: ${new Date(item.plan.time.archived!).toISOString()}`,
        ].join("\n"),
      }
    }

    if (input.action === "draft_question") {
      const plan = await TeamMainPlan.get(input.plan_id!)
      const id = Identifier.ascending("question")
      const asked = Date.now()
      const first = await TeamMainPlan.append_draft({
        plan_id: plan.id,
        item: {
          id,
          status: "asked",
          question_session_id: plan.owner.question_session_id,
          manager_session_id: ctx.sessionID,
          questions: input.questions!,
          answers: [],
          time: { asked },
        },
      })
      await Bus.publish(TeamMainPlan.Event.Updated, { change: "draft_asked", ...first })

      try {
        const reply = await Question.ask({
          sessionID: plan.owner.question_session_id,
          questions: input.questions!,
          tool:
            plan.owner.question_session_id === ctx.sessionID && ctx.callID
              ? {
                  messageID: ctx.messageID,
                  callID: ctx.callID,
                }
              : undefined,
        })
        const next = await TeamMainPlan.update_draft({
          plan_id: plan.id,
          item_id: id,
          status: "answered",
          answers: reply.map((answer) => [...answer]),
          answered: Date.now(),
        })
        await Bus.publish(TeamMainPlan.Event.Updated, { change: "draft_answered", ...next })
        const metadata = {
          plan_id: next.plan.id,
          file: TeamMainPlan.relative(next.file),
          change: "draft_answered",
          tracking: next.plan.stats,
          question_session_id: next.plan.owner.question_session_id,
          plan: next.plan,
        }
        ctx.metadata({
          title: `Asked ${input.questions!.length} draft question${input.questions!.length > 1 ? "s" : ""}`,
          metadata,
        })
        return {
          title: `Asked ${input.questions!.length} draft question${input.questions!.length > 1 ? "s" : ""}`,
          metadata,
          output: [
            info(next.plan, next.file),
            "",
            `question_session_id: ${next.plan.owner.question_session_id}`,
            `answers: ${answers(reply, input.questions!)}`,
          ].join("\n"),
        }
      } catch (error) {
        if (error instanceof Question.RejectedError) {
          const next = await TeamMainPlan.update_draft({
            plan_id: plan.id,
            item_id: id,
            status: "rejected",
            answered: Date.now(),
          })
          await Bus.publish(TeamMainPlan.Event.Updated, { change: "draft_rejected", ...next })
          const metadata = {
            plan_id: next.plan.id,
            file: TeamMainPlan.relative(next.file),
            change: "draft_rejected",
            tracking: next.plan.stats,
            question_session_id: next.plan.owner.question_session_id,
            plan: next.plan,
          }
          ctx.metadata({ title: `Draft question dismissed`, metadata })
          return {
            title: `Draft question dismissed`,
            metadata,
            output: [
              info(next.plan, next.file),
              "",
              `question_session_id: ${next.plan.owner.question_session_id}`,
            ].join("\n"),
          }
        }
        const next = await TeamMainPlan.update_draft({
          plan_id: plan.id,
          item_id: id,
          status: "failed",
          answered: Date.now(),
        })
        await Bus.publish(TeamMainPlan.Event.Updated, { change: "draft_failed", ...next })
        throw error
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
    const phase = item.plan.phases.find((item) => item.id === input.phase_id!)
    const task = phase?.tasks.find((item) => item.id === input.task_id!)
    const metadata = {
      plan_id: item.plan.id,
      file: TeamMainPlan.relative(item.file),
      change: "task_updated",
      tracking: item.plan.stats,
      question_session_id: item.plan.owner.question_session_id,
      plan: item.plan,
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
