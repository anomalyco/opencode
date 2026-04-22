import { BusEvent } from "@/bus/bus-event"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { MessageID, SessionID } from "@/session/schema"
import { Flock } from "@/util/flock"
import { Question } from "@/question"
import { mkdir, readdir, unlink } from "node:fs/promises"
import path from "path"
import z from "zod"

export namespace TeamMainPlan {
  export const folder = "main-plan"

  const ratio = z.number().min(0).max(1)
  const plan_id = Identifier.schema("plan")
    .regex(/^pln_[A-Za-z0-9_-]+$/)
    .meta({ ref: "MainPlanID" })
  const item_ref = z
    .object({
      phase_id: z.string(),
      task_id: z.string().optional(),
      note: z.string().optional(),
    })
    .meta({ ref: "MainPlanItemRef" })
  const phase_ref = z
    .object({
      phase_id: z.string(),
      note: z.string().optional(),
    })
    .meta({ ref: "MainPlanPhaseRef" })
  const task_status = z.enum(["pending", "running", "blocked", "done", "cancelled"]).meta({
    ref: "MainPlanTaskStatus",
  })

  const task_state = z
    .object({
      status: task_status.default("pending"),
      done: z.boolean().default(false),
      objective: ratio.default(0),
      tests: ratio.default(0),
      summary: z.string().default(""),
      risks: z.array(z.string()).default([]),
      blockers: z.array(z.string()).default([]),
      evidence: z.array(z.string()).default([]),
      affected_files: z.array(z.string()).default([]),
    })
    .meta({ ref: "MainPlanTaskState" })

  const task_stats = z
    .object({
      progress: ratio,
      objective: ratio,
      tests: ratio,
      done_score: z.number(),
    })
    .meta({ ref: "MainPlanTaskStats" })

  const task_input = z
    .object({
      id: z.string(),
      order: z.number().int().positive().optional(),
      title: z.string(),
      kind: z.string(),
      lane: z.string().optional(),
      goal: z.string(),
      feature: z.string(),
      details: z.string(),
      suggested_files: z.array(z.string()).default([]),
      checkpoints: z.array(z.string()).default([]),
      parallel: z.array(item_ref).default([]),
      depends_on: z.array(item_ref).default([]),
      score: z.number().nonnegative(),
      state: task_state.optional(),
    })
    .meta({ ref: "MainPlanTaskInput" })

  const task = task_input.extend({
    state: task_state,
    stats: task_stats,
  })

  const phase_stats = z
    .object({
      score_total: z.number(),
      score_done: z.number(),
      progress: ratio,
      objective: ratio,
      tests: ratio,
      task_total: z.number().int().nonnegative(),
      task_done: z.number().int().nonnegative(),
    })
    .meta({ ref: "MainPlanPhaseStats" })

  const phase_input = z
    .object({
      id: z.string(),
      order: z.number().int().positive().optional(),
      title: z.string(),
      context: z.string(),
      parallel: z.array(phase_ref).default([]),
      depends_on: z.array(z.string()).default([]),
      exit_conditions: z.array(z.string()).default([]),
      tasks: z.array(task_input).default([]),
    })
    .meta({ ref: "MainPlanPhaseInput" })

  const phase = phase_input.extend({
    tasks: z.array(task),
    stats: phase_stats,
  })

  const draft_status = z.enum(["asked", "answered", "rejected", "failed"])
  const draft_item = z
    .object({
      id: z.string(),
      status: draft_status,
      question_session_id: SessionID.zod,
      manager_session_id: SessionID.zod,
      questions: z.array(Question.Info.omit({ custom: true })),
      answers: z.array(Question.Answer).default([]),
      time: z.object({
        asked: z.number(),
        answered: z.number().optional(),
      }),
    })
    .meta({ ref: "MainPlanDraftItem" })

  const draft = z
    .object({
      notes: z.string().default(""),
      // Frontend: keep the full interview trail here so draft screens can replay what was asked and answered.
      questions: z.array(draft_item).default([]),
    })
    .meta({ ref: "MainPlanDraft" })

  const handoff = z
    .object({
      route: z.string().default(""),
      summary: z.string().default(""),
    })
    .meta({ ref: "MainPlanHandoff" })

  const prompt = z
    .object({
      raw: z.string().optional(),
      meta: z.string(),
    })
    .meta({ ref: "MainPlanPrompt" })

  const owner = z
    .object({
      agent: z.string(),
      session_id: SessionID.zod,
      message_id: MessageID.zod,
      call_id: z.string().optional(),
      // Frontend: render draft questions in this session even when niggli manages the plan from a child session.
      question_session_id: SessionID.zod,
      caller_session_id: SessionID.zod.optional(),
    })
    .meta({ ref: "MainPlanOwner" })

  const stats = z
    .object({
      score_total: z.number(),
      score_done: z.number(),
      progress: ratio,
      objective: ratio,
      tests: ratio,
      phase_total: z.number().int().nonnegative(),
      phase_done: z.number().int().nonnegative(),
      task_total: z.number().int().nonnegative(),
      task_done: z.number().int().nonnegative(),
    })
    .meta({ ref: "MainPlanStats" })

  const raw_plan = z
    .object({
      id: plan_id.optional(),
      kind: z.literal("main-plan").optional(),
      version: z.literal(1).optional(),
      title: z.string().optional(),
      title_ui: z.string().optional(),
      prompt,
      owner,
      draft: draft.optional(),
      handoff: handoff.optional(),
      goal: z.string(),
      goal_ui: z.string().optional(),
      scope: z.string(),
      scope_ui: z.string().optional(),
      target: z.string(),
      target_ui: z.string().optional(),
      phases: z.array(phase_input).default([]),
      stats: stats.optional(),
      time: z.object({
        created: z.number(),
        updated: z.number().optional(),
        archived: z.number().optional(),
      }),
      ui_locale: z.string().optional(),
      is_translate: z.boolean().optional(),
      translate_status: z.enum(["idle", "waiting", "started", "finished"]).optional(),
      translate_done: z.number().int().nonnegative().optional(),
      translate_total: z.number().int().nonnegative().optional(),
      translate_updated: z.number().optional(),
    })
    .meta({ ref: "MainPlanRaw" })

  const plan = z
    .object({
      id: plan_id,
      kind: z.literal("main-plan"),
      version: z.literal(1),
      title: z.string(),
      title_ui: z.string().optional(),
      prompt,
      owner,
      draft,
      handoff,
      goal: z.string(),
      goal_ui: z.string().optional(),
      scope: z.string(),
      scope_ui: z.string().optional(),
      target: z.string(),
      target_ui: z.string().optional(),
      phases: z.array(phase),
      stats,
      time: z.object({
        created: z.number(),
        updated: z.number(),
        archived: z.number().optional(),
      }),
      ui_locale: z.string().optional(),
      is_translate: z.boolean().optional(),
      translate_status: z.enum(["idle", "waiting", "started", "finished"]).optional(),
      translate_done: z.number().int().nonnegative().optional(),
      translate_total: z.number().int().nonnegative().optional(),
      translate_updated: z.number().optional(),
    })
    .meta({ ref: "MainPlan" })

  export const PlanID = plan_id
  export type PlanID = z.infer<typeof plan_id>
  export const ItemRef = item_ref
  export const PhaseRef = phase_ref
  export const TaskStatus = task_status
  export const TaskState = task_state
  export const TaskStats = task_stats
  export const TaskInput = task_input
  export const Task = task
  export const PhaseStats = phase_stats
  export const PhaseInput = phase_input
  export const Phase = phase
  export const DraftStatus = draft_status
  export const DraftItem = draft_item
  export const Draft = draft
  export const Handoff = handoff
  export const Prompt = prompt
  export const Owner = owner
  export const Stats = stats
  export const Plan = plan
  export type ItemRef = z.infer<typeof item_ref>
  export type PhaseRef = z.infer<typeof phase_ref>
  export type TaskStatus = z.infer<typeof task_status>
  export type TaskState = z.infer<typeof task_state>
  export type TaskStats = z.infer<typeof task_stats>
  export type TaskInput = z.infer<typeof task_input>
  export type Task = z.infer<typeof task>
  export type PhaseStats = z.infer<typeof phase_stats>
  export type PhaseInput = z.infer<typeof phase_input>
  export type Phase = z.infer<typeof phase>
  export type DraftStatus = z.infer<typeof draft_status>
  export type DraftItem = z.infer<typeof draft_item>
  export type Draft = z.infer<typeof draft>
  export type Handoff = z.infer<typeof handoff>
  export type Prompt = z.infer<typeof prompt>
  export type Owner = z.infer<typeof owner>
  export type Stats = z.infer<typeof stats>
  export type Plan = z.infer<typeof plan>

  export const Event = {
    Created: BusEvent.define(
      "main_plan.created",
      z.object({
        plan: Plan,
        file: z.string(),
      }),
    ),
    Updated: BusEvent.define(
      "main_plan.updated",
      z.object({
        change: z.enum([
          "set",
          "draft_asked",
          "draft_answered",
          "draft_rejected",
          "draft_failed",
          "task_updated",
          "archived",
        ]),
        plan: Plan,
        file: z.string(),
      }),
    ),
    Deleted: BusEvent.define(
      "main_plan.deleted",
      z.object({
        plan: Plan,
        file: z.string(),
      }),
    ),
  }

  function pct(value: number) {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= 1) return 1
    return value
  }

  function total(list: number[]) {
    return list.reduce((sum, item) => sum + item, 0)
  }

  function filled(value?: string) {
    return !!value?.trim()
  }

  function source_changed(prev: Plan, next: Pick<Plan, "title" | "goal" | "scope" | "target">) {
    return (
      prev.title !== next.title || prev.goal !== next.goal || prev.scope !== next.scope || prev.target !== next.target
    )
  }

  function reset_translation(updated = Date.now()) {
    return {
      title_ui: undefined,
      goal_ui: undefined,
      scope_ui: undefined,
      target_ui: undefined,
      ui_locale: undefined,
      is_translate: false,
      translate_status: "idle" as const,
      translate_done: 0,
      translate_total: 0,
      translate_updated: updated,
    }
  }

  export function open_draft_questions(plan: Plan) {
    return plan.draft.questions.filter((item) => item.status === "asked").length
  }

  export function has_execution_handoff(plan: Pick<Plan, "handoff">) {
    return filled(plan.handoff.route) && filled(plan.handoff.summary)
  }

  function task_map(plan: Plan) {
    return new Map(
      plan.phases.flatMap((phase) => phase.tasks.map((task) => [`${phase.id}:${task.id}`, task] as const)),
    )
  }

  export function readiness_issues(plan: Plan) {
    const issues: string[] = []
    const phases = new Map(plan.phases.map((phase) => [phase.id, phase]))
    const tasks = task_map(plan)
    const ready = plan.handoff.route.trim().toLowerCase() === "lead"
    if (plan.stats.phase_total === 0) issues.push("plan has no phases")
    if (plan.stats.task_total === 0) issues.push("plan has no tasks")
    if (open_draft_questions(plan) > 0) issues.push("plan still has open draft questions")
    if (!filled(plan.handoff.route)) issues.push("handoff route is missing")
    if (!filled(plan.handoff.summary)) issues.push("handoff summary is missing")
    const phase_ids = new Set<string>()
    for (const phase of plan.phases) {
      if (phase_ids.has(phase.id)) issues.push(`phase ${phase.id} is duplicated`)
      phase_ids.add(phase.id)
      if (!filled(phase.context)) issues.push(`phase ${phase.id} is missing context`)
      if (phase.exit_conditions.length === 0) issues.push(`phase ${phase.id} has no exit conditions`)
      if (phase.tasks.length === 0) issues.push(`phase ${phase.id} has no tasks`)
      for (const dep of phase.depends_on) {
        if (dep === phase.id) issues.push(`phase ${phase.id} depends on itself`)
        if (!phases.has(dep)) issues.push(`phase ${phase.id} depends on missing phase ${dep}`)
      }
      for (const ref of phase.parallel) {
        if (ref.phase_id === phase.id) issues.push(`phase ${phase.id} is marked parallel with itself`)
        if (!phases.has(ref.phase_id)) issues.push(`phase ${phase.id} is parallel with missing phase ${ref.phase_id}`)
      }
      const task_ids = new Set<string>()
      for (const task of phase.tasks) {
        const name = `phase ${phase.id} task ${task.id}`
        if (task_ids.has(task.id)) issues.push(`${name} is duplicated inside the phase`)
        task_ids.add(task.id)
        if (!filled(task.details)) issues.push(`${name} is missing details`)
        if (task.checkpoints.length === 0) issues.push(`${name} has no checkpoints`)
        if (task.score <= 0) issues.push(`${name} has non-positive score`)
        if (ready && !filled(task.lane)) issues.push(`${name} is missing lane for lead handoff`)
        if (task.state.status === "blocked" && task.state.blockers.length === 0) {
          issues.push(`${name} is blocked without blockers`) 
        }
        for (const ref of [...task.depends_on, ...task.parallel]) {
          const key = ref.task_id ? (`${ref.phase_id}:${ref.task_id}` as const) : undefined
          if (ref.phase_id === phase.id && ref.task_id === task.id) issues.push(`${name} references itself`)
          if (!phases.has(ref.phase_id)) issues.push(`${name} references missing phase ${ref.phase_id}`)
          if (key && !tasks.has(key)) issues.push(`${name} references missing task ${ref.phase_id}/${ref.task_id}`)
        }
      }
    }
    return [...new Set(issues)]
  }

  export function is_ready_for_execution(plan: Plan) {
    return readiness_issues(plan).length === 0
  }

  function task_state_row(input: TaskState): TaskState {
    const done = input.done || input.status === "done"
    const objective = done ? 1 : input.objective >= 1 ? 0.99 : input.objective
    return task_state.parse({
      ...input,
      objective,
      status: done ? "done" : input.status,
      done,
    })
  }

  function task_row(input: TaskInput, order: number): Task {
    const state = task_state_row(task_state.parse(input.state ?? {}))
    const score = Number.isFinite(input.score) ? Math.max(0, input.score) : 0
    return {
      ...input,
      order: input.order ?? order,
      lane: input.lane?.trim() || "",
      suggested_files: input.suggested_files ?? [],
      checkpoints: input.checkpoints ?? [],
      parallel: input.parallel ?? [],
      depends_on: input.depends_on ?? [],
      score,
      state,
      stats: {
        progress: state.done ? 1 : pct(state.objective),
        objective: pct(state.objective),
        tests: pct(state.tests),
        done_score: state.done ? score : 0,
      },
    }
  }

  function phase_row(input: PhaseInput, order: number): Phase {
    const tasks = input.tasks.map((task, i) => task_row(task, i + 1))
    const score_total = total(tasks.map((item) => item.score))
    const score_done = total(tasks.map((item) => item.stats.done_score))
    const weighted_objective = total(tasks.map((item) => item.score * item.stats.objective))
    const weighted_tests = total(tasks.map((item) => item.score * item.stats.tests))
    const task_done = tasks.filter((item) => item.state.done).length
    return {
      ...input,
      order: input.order ?? order,
      parallel: input.parallel ?? [],
      depends_on: input.depends_on ?? [],
      exit_conditions: input.exit_conditions ?? [],
      tasks,
      stats: {
        score_total,
        score_done,
        progress: score_total > 0 ? score_done / score_total : 0,
        objective: score_total > 0 ? weighted_objective / score_total : 0,
        tests: score_total > 0 ? weighted_tests / score_total : 0,
        task_total: tasks.length,
        task_done,
      },
    }
  }

  function plan_row(input: z.infer<typeof raw_plan>): Plan {
    const phases = input.phases.map((phase, i) => phase_row(phase, i + 1))
    const score_total = total(phases.map((item) => item.stats.score_total))
    const score_done = total(phases.map((item) => item.stats.score_done))
    const weighted_objective = total(phases.map((item) => item.stats.score_total * item.stats.objective))
    const weighted_tests = total(phases.map((item) => item.stats.score_total * item.stats.tests))
    const task_total = total(phases.map((item) => item.stats.task_total))
    const task_done = total(phases.map((item) => item.stats.task_done))
    const phase_done = phases.filter(
      (item) => item.stats.task_total > 0 && item.stats.task_total === item.stats.task_done,
    ).length
    return {
      id: input.id ?? PlanID.parse(Identifier.ascending("plan")),
      kind: "main-plan",
      version: 1,
      title: input.title?.trim() || input.goal.trim() || "main plan",
      title_ui: input.title_ui,
      prompt: input.prompt,
      owner: input.owner,
      draft: draft.parse(input.draft ?? {}),
      handoff: handoff.parse(input.handoff ?? {}),
      goal: input.goal,
      goal_ui: input.goal_ui,
      scope: input.scope,
      scope_ui: input.scope_ui,
      target: input.target,
      target_ui: input.target_ui,
      phases,
      stats: {
        score_total,
        score_done,
        progress: score_total > 0 ? score_done / score_total : 0,
        objective: score_total > 0 ? weighted_objective / score_total : 0,
        tests: score_total > 0 ? weighted_tests / score_total : 0,
        phase_total: phases.length,
        phase_done,
        task_total,
        task_done,
      },
      time: {
        created: input.time.created,
        updated: input.time.updated ?? input.time.created,
        archived: input.time.archived,
      },
      ui_locale: input.ui_locale,
      is_translate: input.is_translate,
      translate_status: input.translate_status,
      translate_done: input.translate_done,
      translate_total: input.translate_total,
      translate_updated: input.translate_updated,
    }
  }

  export function preserve_phases(cur: Phase[], next?: PhaseInput[]) {
    if (!next) return cur
    return next.map((phase) => {
      const prev = cur.find((item) => item.id === phase.id)
      return {
        ...phase,
        tasks: phase.tasks.map((task) => ({
          ...task,
          state: task.state ?? prev?.tasks.find((item) => item.id === task.id)?.state,
        })),
      }
    })
  }

  function root() {
    return path.join(Global.Path.config, "projects", Instance.project.id, folder)
  }

  function plan_file_id(id: PlanID | string) {
    return PlanID.parse(id)
  }

  export function file(id: PlanID | string) {
    return path.join(root(), `${plan_file_id(id)}.json`)
  }

  export function relative(file: string) {
    const out = path.relative(Global.Path.config, file).replaceAll("\\", "/")
    return out || "."
  }

  async function ensure() {
    await mkdir(root(), { recursive: true })
  }

  async function read(file: string) {
    const item = Bun.file(file)
    if (!(await item.exists())) return
    const raw = await item.json()
    return plan_row(raw_plan.parse(raw))
  }

  async function write(plan: Plan) {
    const next = TeamMainPlan.Plan.parse({
      ...plan,
      title: plan.title.trim() || plan.goal.trim() || "main plan",
    })
    await ensure()
    const file = TeamMainPlan.file(next.id)
    await Bun.write(file, JSON.stringify(next, null, 2) + "\n")
    const saved = await read(file)
    if (!saved) {
      throw new Error(`Plan ${next.id} could not be read back after write`)
    }
    if (JSON.stringify(saved) !== JSON.stringify(next)) {
      throw new Error(`Plan ${next.id} persisted content diverged from the requested update`)
    }
    return { plan: saved, file }
  }

  function lock(id?: string) {
    return id ? `main-plan:${Instance.project.id}:${id}` : `main-plan:${Instance.project.id}`
  }

  export async function list(input?: {
    session_id?: SessionID | string
    owner_session_id?: SessionID | string
    archived?: boolean
  }) {
    await ensure()
    const archived = input?.archived ?? false
    const names = await readdir(root()).catch(() => [])
    const rows = (
      await Promise.all(names.filter((item) => item.endsWith(".json")).map((item) => read(path.join(root(), item))))
    ).filter((item): item is Plan => !!item)
    const list = rows.filter((item) => {
      if (!!item.time.archived !== archived) return false
      if (input?.session_id && item.owner.question_session_id !== input.session_id) return false
      if (input?.owner_session_id && item.owner.session_id !== input.owner_session_id) return false
      return true
    })
    return list.toSorted((a, b) => b.time.updated - a.time.updated)
  }

  export async function get(id: PlanID | string) {
    const plan = await read(file(id))
    if (!plan) throw new Error(`Plan ${id} was not found`)
    return plan
  }

  export async function create(input: {
    title?: string
    prompt: Prompt
    owner: Owner
    draft?: Draft
    handoff?: Handoff
    goal: string
    scope: string
    target: string
    phases?: PhaseInput[]
    time?: { created?: number; updated?: number }
  }) {
    return Flock.withLock(lock(), async () => {
      const time = input.time?.created ?? Date.now()
      return write(
        plan_row(
          raw_plan.parse({
            id: Identifier.ascending("plan"),
            title: input.title,
            prompt: input.prompt,
            owner: input.owner,
            draft: input.draft,
            handoff: input.handoff,
            goal: input.goal,
            scope: input.scope,
            target: input.target,
            phases: input.phases ?? [],
            time: {
              created: time,
              updated: input.time?.updated ?? time,
            },
          }),
        ),
      )
    })
  }

  function update_row(cur: Plan, next: unknown, updated: number) {
    if (typeof next !== "object" || next === null) {
      throw new Error("Plan update must return an object")
    }
    const archived = (next as { time?: { archived?: number } }).time
    const parsed = raw_plan.parse({
      ...next,
      id: cur.id,
      time: {
        created: cur.time.created,
        updated,
        archived:
          archived && Object.prototype.hasOwnProperty.call(archived, "archived")
            ? archived.archived
            : cur.time.archived,
      },
    })
    const fresh = source_changed(cur, {
      title: parsed.title?.trim() || parsed.goal.trim() || "main plan",
      goal: parsed.goal,
      scope: parsed.scope,
      target: parsed.target,
    })
      ? raw_plan.parse({
          ...parsed,
          ...reset_translation(updated),
        })
      : parsed
    return plan_row(fresh)
  }

  async function update_when(
    id: PlanID | string,
    fn: (plan: Plan) => unknown,
    when?: (plan: Plan) => boolean,
  ): Promise<{ plan: Plan; file: string } | undefined> {
    const loc = file(id)
    return Flock.withLock(lock(String(id)), async () => {
      const cur = await read(loc)
      if (!cur) throw new Error(`Plan ${id} was not found`)
      if (when && !when(cur)) return
      return write(update_row(cur, fn(cur), Date.now()))
    })
  }

  export async function update(
    id: PlanID | string,
    fn: (plan: Plan) => unknown,
  ): Promise<{ plan: Plan; file: string }> {
    const result = await update_when(id, fn)
    if (!result) throw new Error(`Plan ${id} update was skipped unexpectedly`)
    return result
  }

  export async function update_if(
    id: PlanID | string,
    when: (plan: Plan) => boolean,
    fn: (plan: Plan) => unknown,
  ): Promise<{ plan: Plan; file: string } | undefined> {
    return update_when(id, fn, when)
  }

  export async function archive(input: { plan_id: PlanID | string; time?: number }) {
    return update(input.plan_id, (plan) => ({
      ...plan,
      time: {
        ...plan.time,
        archived: input.time ?? Date.now(),
      },
    }))
  }

  export async function remove(id: PlanID | string) {
    const loc = file(id)
    return Flock.withLock(lock(String(id)), async () => {
      const plan = await read(loc)
      if (!plan) throw new Error(`Plan ${id} was not found`)
      await unlink(loc)
      return { plan, file: loc }
    })
  }

  export async function update_task(input: {
    plan_id: PlanID | string
    phase_id: string
    task_id: string
    state: Partial<
      Pick<TaskState, "status" | "done" | "objective" | "tests" | "summary" | "risks" | "blockers" | "evidence" | "affected_files">
    >
  }) {
    const state = Object.fromEntries(Object.entries(input.state).filter(([, item]) => item !== undefined))
    return update(input.plan_id, (plan) => {
      let phase_hit = false
      let task_hit = false
      const next = {
        ...plan,
        phases: plan.phases.map((phase) => {
          if (phase.id !== input.phase_id) return phase
          phase_hit = true
          return {
            ...phase,
            tasks: phase.tasks.map((task) => {
              if (task.id !== input.task_id) return task
              task_hit = true
              const next = {
                ...task.state,
                ...state,
              }
              if (state.done !== undefined && state.status === undefined) {
                next.status = state.done ? "done" : next.status === "done" ? "pending" : next.status
              }
              if (state.status !== undefined && state.done === undefined) {
                next.done = state.status === "done"
              }
              return {
                ...task,
                state: task_state_row(task_state.parse(next)),
              }
            }),
          }
        }),
      }
      if (!phase_hit || !task_hit) {
        throw new Error(`Task ${input.task_id} in phase ${input.phase_id} was not found`)
      }
      return next
    })
  }

  export async function append_draft(input: { plan_id: PlanID | string; item: DraftItem }) {
    return update(input.plan_id, (plan) => ({
      ...plan,
      draft: {
        ...plan.draft,
        questions: [...plan.draft.questions, input.item],
      },
    }))
  }

  export async function update_draft(input: {
    plan_id: PlanID | string
    item_id: string
    status: DraftStatus
    answers?: z.infer<typeof Question.Answer>[]
    answered?: number
  }) {
    return update(input.plan_id, (plan) => {
      let hit = false
      const next = {
        ...plan,
        draft: {
          ...plan.draft,
          questions: plan.draft.questions.map((item) => {
            if (item.id !== input.item_id) return item
            hit = true
            return {
              ...item,
              status: input.status,
              answers: input.answers ?? item.answers,
              time: {
                ...item.time,
                answered: input.answered ?? item.time.answered,
              },
            }
          }),
        },
      }
      if (!hit) throw new Error(`Draft item ${input.item_id} was not found`)
      return next
    })
  }
}
