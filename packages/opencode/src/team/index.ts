import z from "zod"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Lock } from "../util/lock"
import { fn } from "../util/fn"
import {
  TeamEvent,
  MemberStatus as MemberStatusSchema,
  ExecutionStatus,
  TeamInfoSchema,
  TeamTaskSchema,
  type TeamInfo,
  type TeamMember,
  type TeamTask,
  type MemberStatus,
  type ExecutionStatus as ExecutionStatusType,
} from "./events"

export {
  TeamEvent,
  ExecutionStatus,
  TeamInfoSchema,
  TeamTaskSchema,
  type TeamInfo,
  type TeamMember,
  type TeamTask,
} from "./events"

/** Write tools that are denied during plan-approval or delegate mode */
export const WRITE_TOOLS = ["bash", "write", "edit", "multiedit", "apply_patch"] as const

const log = Log.create({ service: "team" })

/** Storage key for a team's config */
function configKey(name: string): string[] {
  return ["team", Instance.project.id, name]
}

/** Storage key for a team's task list — separate prefix from "team" so
 *  Storage.list(["team", projectID]) only returns config keys, not task data */
function tasksKey(name: string): string[] {
  return ["team_tasks", Instance.project.id, name]
}

const TERMINAL_EXECUTION_STATES = new Set<ExecutionStatusType>([
  "idle",
  "cancelled",
  "completed",
  "failed",
  "timed_out",
])

const CREATE_LOCK_KEY = () => `team:create:${Instance.project.id}`

const MEMBER_TRANSITIONS: Record<MemberStatus, MemberStatus[]> = {
  ready: ["busy", "shutdown_requested", "shutdown", "error"],
  busy: ["ready", "shutdown_requested", "error"],
  shutdown_requested: ["shutdown", "error"],
  shutdown: [],
  error: ["ready", "shutdown_requested", "shutdown"],
}

const EXECUTION_TRANSITIONS: Record<ExecutionStatusType, ExecutionStatusType[]> = {
  idle: ["starting"],
  starting: ["running", "cancel_requested", "cancelling", "failed", "timed_out"],
  running: ["cancel_requested", "cancelling", "completing", "failed", "timed_out"],
  cancel_requested: ["cancelling", "cancelled", "failed", "timed_out"],
  cancelling: ["cancelled", "failed", "timed_out"],
  cancelled: ["idle"],
  completing: ["completed", "failed", "timed_out"],
  completed: ["idle"],
  failed: ["idle"],
  timed_out: ["idle"],
}

function normalizeMember(member: TeamMember): TeamMember {
  const status = MemberStatusSchema.parse(member.status)
  const execution_status = ExecutionStatus.safeParse(member.execution_status).success
    ? member.execution_status
    : status === "busy"
      ? "running"
      : "idle"
  return {
    ...member,
    status,
    execution_status,
  }
}

function normalizeTeam(team: TeamInfo): TeamInfo {
  return {
    ...team,
    members: team.members.map(normalizeMember),
  }
}

function canTransition<T extends string>(current: T, next: T, map: Record<T, T[]>) {
  if (current === next) return true
  return map[current]?.includes(next) === true
}

export namespace Team {
  /**
   * Subscribe to member status changes and auto-cleanup teams
   * when all members have reached "shutdown" status.
   * Called once during InstanceBootstrap.
   */
  export function autoCleanup(): () => void {
    return Bus.subscribe(TeamEvent.MemberStatusChanged, async (event) => {
      if (event.properties.status !== "shutdown") return

      const team = await get(event.properties.teamName)
      if (!team) return
      if (team.members.length === 0) return
      if (team.members.some((m) => m.status !== "shutdown")) return

      log.info("all members shutdown, auto-cleaning team", { teamName: team.name })
      try {
        await cleanup(team.name)
      } catch (err: unknown) {
        log.warn("auto-cleanup failed", {
          teamName: team.name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }

  /**
   * Listen for TeamEvent.Cleaned and restore session permissions.
   * This decouples the team module from the session module —
   * cleanup only publishes the event, this listener handles session side-effects.
   */
  export function onCleanedRestorePermissions(): () => void {
    return Bus.subscribe(TeamEvent.Cleaned, async (event) => {
      if (!event.properties.delegate) return

      try {
        const { Session } = await import("../session")
        await Session.update(event.properties.leadSessionID, (draft) => {
          draft.permission = (draft.permission ?? []).filter(
            (rule) => !((WRITE_TOOLS as readonly string[]).includes(rule.permission) && rule.action === "deny"),
          )
        })
        log.info("restored lead session permissions", {
          teamName: event.properties.teamName,
          sessionID: event.properties.leadSessionID,
        })
      } catch (err: unknown) {
        log.warn("failed to restore lead session permissions", {
          teamName: event.properties.teamName,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }

  /**
   * Create a new team. The lead session is the caller's session.
   */
  export const create = fn(
    z.object({
      name: z.string(),
      leadSessionID: z.string(),
      delegate: z.boolean().optional(),
    }),
    async (input) => {
      using _ = await Lock.write(CREATE_LOCK_KEY())

      const existing = await get(input.name)
      if (existing) throw new Error(`Team "${input.name}" already exists`)

      const lead = await findBySession(input.leadSessionID)
      if (lead?.role === "lead")
        throw new Error(`Session is already leading team "${lead.team.name}". Only one team per session is allowed.`)
      if (lead?.role === "member")
        throw new Error(`This session is a teammate in "${lead.team.name}". Teammates cannot create new teams.`)

      const team: TeamInfo = {
        name: input.name,
        leadSessionID: input.leadSessionID,
        members: [],
        created: Date.now(),
        ...(input.delegate ? { delegate: true } : {}),
      }

      await Storage.write(configKey(input.name), team)
      await Storage.write(tasksKey(input.name), [] as TeamTask[])

      log.info("team created", { name: input.name, leadSessionID: input.leadSessionID })
      await Bus.publish(TeamEvent.Created, { team })
      return team
    },
  )

  /**
   * Get a team by name. Returns undefined if not found.
   */
  export const get = fn(z.string(), async (name) => {
    try {
      return normalizeTeam(await Storage.read<TeamInfo>(configKey(name)))
    } catch {
      return undefined
    }
  })

  /**
   * List all teams in this project.
   */
  export async function list(): Promise<TeamInfo[]> {
    try {
      const keys = await Storage.list(["team", Instance.project.id])
      return (await Promise.all(keys.map((key) => Storage.read<TeamInfo>(key).catch(() => undefined))))
        .filter((t): t is TeamInfo => t !== undefined)
        .map(normalizeTeam)
    } catch {
      return []
    }
  }

  /**
   * Add a member to a team (atomic via Storage.update).
   * Rejects duplicate names (case-insensitive), duplicate sessionIDs, and "lead" as a name.
   */
  export async function addMember(teamName: string, member: TeamMember): Promise<void> {
    const lower = member.name.toLowerCase()
    if (lower === "lead") throw new Error(`Name "lead" is reserved and cannot be used for a teammate.`)

    await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
      if (draft.members.some((m) => m.name.toLowerCase() === lower))
        throw new Error(`Teammate "${member.name}" already exists in team "${teamName}" (case-insensitive)`)
      if (draft.members.some((m) => m.sessionID === member.sessionID))
        throw new Error(`Session "${member.sessionID}" is already registered in team "${teamName}"`)
      draft.members.push(member)
    })

    log.info("member added", { teamName, member: member.name, agent: member.agent })
    await Bus.publish(TeamEvent.MemberSpawned, { teamName, member })
  }

  export async function transitionMemberStatus(
    teamName: string,
    memberName: string,
    status: MemberStatus,
    options?: { guard?: boolean; force?: boolean },
  ): Promise<boolean> {
    let changed = false
    try {
      await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
        const member = draft.members.find((m) => m.name === memberName)
        if (!member) return
        if (options?.guard && member.status === "shutdown") return
        const from = member.status
        if (!options?.force && !canTransition(from, status, MEMBER_TRANSITIONS)) return
        if (from === status) return
        member.status = status
        changed = true
      })
    } catch {
      return false
    }
    if (!changed) return false
    await Bus.publish(TeamEvent.MemberStatusChanged, { teamName, memberName, status })
    return true
  }

  export async function transitionExecutionStatus(
    teamName: string,
    memberName: string,
    status: ExecutionStatusType,
    options?: { force?: boolean },
  ): Promise<boolean> {
    let changed = false
    try {
      await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
        const member = draft.members.find((m) => m.name === memberName)
        if (!member) return
        const from = normalizeMember(member).execution_status ?? "idle"
        if (!options?.force && !canTransition(from, status, EXECUTION_TRANSITIONS)) return
        if (from === status) return
        member.execution_status = status
        changed = true
      })
    } catch {
      return false
    }
    if (!changed) return false
    await Bus.publish(TeamEvent.MemberExecutionChanged, { teamName, memberName, status })
    return true
  }

  /**
   * Backward-compatible setter for tests and call sites that need direct status updates.
   */
  export async function setMemberStatus(
    teamName: string,
    memberName: string,
    status: MemberStatus,
    options?: { guard?: boolean },
  ): Promise<void> {
    await transitionMemberStatus(teamName, memberName, status, { guard: options?.guard, force: true })
  }

  /**
   * Toggle delegate mode on a team.
   */
  export async function setDelegate(teamName: string, delegate: boolean): Promise<void> {
    try {
      await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
        draft.delegate = delegate
      })
    } catch {
      // Team not found — ignore
    }
  }

  /**
   * Update a member's plan approval status.
   */
  export async function setMemberPlanApproval(
    teamName: string,
    memberName: string,
    planApproval: "none" | "pending" | "approved" | "rejected",
  ): Promise<void> {
    try {
      await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
        const member = draft.members.find((m) => m.name === memberName)
        if (!member) return
        member.planApproval = planApproval
      })
    } catch {
      // Team not found — ignore
    }
  }

  /**
   * Remove a member from a team.
   */
  export async function removeMember(teamName: string, memberName: string): Promise<void> {
    try {
      await Storage.update<TeamInfo>(configKey(teamName), (draft) => {
        draft.members = draft.members.filter((m) => m.name !== memberName)
      })
    } catch {
      // Team not found — ignore
    }
    log.info("member removed", { teamName, memberName })
  }

  /**
   * Find which team a session belongs to (as lead or member).
   */
  export async function findBySession(
    sessionID: string,
  ): Promise<{ team: TeamInfo; role: "lead" | "member"; memberName?: string } | undefined> {
    const teams = await list()
    for (const team of teams) {
      if (team.leadSessionID === sessionID) return { team, role: "lead" }
      const member = team.members.find((m) => m.sessionID === sessionID)
      if (member) return { team, role: "member", memberName: member.name }
    }
    return undefined
  }

  /**
   * Resolve the model for a teammate.
   * Priority: explicit model param > agent model > lead's last model > global default.
   * Returns `{ error }` if the explicit model is not found.
   */
  export async function resolveModel(input: {
    model?: string
    agent: { model?: { providerID: string; modelID: string } }
    messages: Array<{ info: { role: string; model?: { providerID: string; modelID: string } } }>
  }): Promise<{ providerID: string; modelID: string } | { error: string }> {
    const { Provider } = await import("../provider/provider")

    if (input.model) {
      const parsed = Provider.parseModel(input.model)
      try {
        await Provider.getModel(parsed.providerID, parsed.modelID)
      } catch (e: unknown) {
        if (Provider.ModelNotFoundError.isInstance(e)) {
          const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
          return { error: `Model not found: ${input.model}.${hint}` }
        }
        throw e
      }
      return parsed
    }
    if (input.agent.model) return input.agent.model
    const lastUser = input.messages.findLast((m) => m.info.role === "user")
    if (lastUser?.info.model) return lastUser.info.model
    return await Provider.defaultModel()
  }

  /**
   * Spawn a teammate — creates session, registers member, starts prompt loop.
   * On addMember failure, cleans up the orphaned session.
   */
  export async function spawnMember(input: {
    teamName: string
    name: string
    parentSessionID: string
    agent: { name: string; prompt?: string; skills?: string[] }
    model: { providerID: string; modelID: string }
    prompt: string
    claimTask?: string
    planApproval: boolean
  }): Promise<{ sessionID: string; label: string }> {
    const { Session } = await import("../session")
    const { SessionPrompt } = await import("../session/prompt")
    const { Identifier } = await import("../id/id")
    const { Instance: Inst } = await import("../project/instance")
    const { TeamMessaging } = await import("./messaging")

    const label = `${input.model.providerID}/${input.model.modelID}`

    // Build permission rules for the child session
    const rules: Array<{ permission: string; pattern: string; action: "deny" | "allow" }> = [
      { permission: "team_create", pattern: "*", action: "deny" },
      { permission: "team_spawn", pattern: "*", action: "deny" },
      { permission: "team_shutdown", pattern: "*", action: "deny" },
      { permission: "team_cleanup", pattern: "*", action: "deny" },
      { permission: "team_approve_plan", pattern: "*", action: "deny" },
    ]
    if (input.planApproval) {
      // Pattern "*:plan-approval" is intentionally NOT "*" — PermissionNext.disabled() only
      // strips tools with pattern "*", so these remain visible to the model but are denied at
      // execution time. The ":plan-approval" tag lets approvePlan() remove only these rules.
      rules.push(
        ...WRITE_TOOLS.map((tool) => ({ permission: tool, pattern: "*:plan-approval", action: "deny" as const })),
      )
    }

    const session = await Session.createNext({
      parentID: input.parentSessionID,
      directory: Inst.directory,
      title: `${input.name} (@${input.agent.name} teammate, ${label})${input.planApproval ? " [plan mode]" : ""}`,
      permission: rules,
    })

    // Register member — if this fails, clean up the orphaned session
    try {
      await addMember(input.teamName, {
        name: input.name,
        sessionID: session.id,
        agent: input.agent.name,
        status: "busy",
        execution_status: "idle",
        prompt: input.prompt,
        model: label,
        planApproval: input.planApproval ? "pending" : "none",
      })
    } catch (err) {
      // Orphaned session cleanup
      try {
        await Session.remove(session.id)
      } catch {
        log.warn("failed to clean up orphaned session", { sessionID: session.id })
      }
      throw err
    }

    if (input.claimTask) {
      await TeamTasks.claim(input.teamName, input.claimTask, input.name).catch(() => {})
    }

    // Build teammate context message
    const planInstructions = input.planApproval
      ? [
          "",
          "IMPORTANT: You are in PLAN MODE (read-only). You can read files, search, and explore,",
          "but you CANNOT write, edit, or run bash commands until the lead approves your plan.",
          "",
          "Your workflow:",
          "1. Research and explore the codebase to understand the problem",
          "2. Formulate a detailed implementation plan",
          "3. Send your plan to the lead using team_message (to: 'lead')",
          "4. Wait for the lead to approve your plan (you'll receive a message when approved)",
          "5. Once approved, your write permissions will be unlocked and you can implement",
          "",
        ]
      : []

    const skillContext = input.agent.skills?.length
      ? [
          "",
          `Preloaded skills: ${input.agent.skills.join(", ")}`,
          "These skills are already loaded into your context — you do not need to invoke the skill tool for them.",
          "",
        ]
      : []

    const context = [
      `You are "${input.name}", a teammate in team "${input.teamName}".`,
      `Your agent type is "${input.agent.name}", using model ${label}.`,
      "",
      "Team tools available to you:",
      "- team_message: send a message to the lead or another teammate",
      "- team_broadcast: send a message to all teammates",
      "- team_tasks: view/add/complete tasks on the shared task list",
      "- team_claim: claim a pending task from the shared task list",
      "",
      "You do NOT have access to team_create, team_spawn, team_shutdown, or team_cleanup.",
      "Only the team lead can manage the team structure.",
      ...skillContext,
      ...planInstructions,
      "When you finish a task, mark it done with team_tasks and send a summary to the lead with team_message.",
      "You can message any teammate by name — not just the lead. Coordinate directly with peers when useful.",
      "",
      "SUBAGENT RELAY: If you use the task tool to spawn subagents, they CANNOT communicate with the team.",
      "You are responsible for relaying any relevant subagent findings via team_message or team_broadcast.",
      "",
      "IMPORTANT: Your plain text output is NOT visible to the team lead or other teammates.",
      "You MUST use team_message or team_broadcast to communicate. Just typing a response is not enough.",
      "",
      "Your instructions:",
      input.prompt,
    ].join("\n")

    const msgId = Identifier.ascending("message")
    await Session.updateMessage({
      id: msgId,
      sessionID: session.id,
      role: "user",
      agent: input.agent.name,
      model: input.model,
      time: { created: Date.now() },
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msgId,
      sessionID: session.id,
      type: "text",
      text: context,
    })

    await transitionMemberStatus(input.teamName, input.name, "busy")
    await transitionExecutionStatus(input.teamName, input.name, "starting")

    // Fire-and-forget the teammate's prompt loop.
    // Wrapped in Promise.resolve().then() to guard against synchronous throws.
    log.info("spawning teammate", { teamName: input.teamName, name: input.name, sessionID: session.id })
    Promise.resolve()
      .then(async () => {
        await transitionExecutionStatus(input.teamName, input.name, "running")
        return SessionPrompt.loop({ sessionID: session.id })
      })
      .then(async () => {
        const team = await get(input.teamName)
        const member = team?.members.find((m) => m.name === input.name)
        const cancelled = member?.execution_status === "cancel_requested" || member?.execution_status === "cancelling"

        log.info("teammate loop ended", {
          teamName: input.teamName,
          name: input.name,
          status: cancelled ? "cancelled" : "completed",
        })

        if (!cancelled) {
          await transitionExecutionStatus(input.teamName, input.name, "completing")
          await transitionExecutionStatus(input.teamName, input.name, "completed")
        }
        if (cancelled) {
          await transitionExecutionStatus(input.teamName, input.name, "cancelling")
          await transitionExecutionStatus(input.teamName, input.name, "cancelled")
        }
        await transitionExecutionStatus(input.teamName, input.name, "idle")
        if (member?.status === "shutdown_requested") {
          await transitionMemberStatus(input.teamName, input.name, "shutdown")
        } else {
          await transitionMemberStatus(input.teamName, input.name, "ready")
        }
        await notifyLead(input.teamName, input.name, session.id, cancelled ? "cancelled" : "completed")
      })
      .catch(async (err) => {
        log.warn("teammate loop error", { teamName: input.teamName, name: input.name, error: err.message })
        await transitionExecutionStatus(input.teamName, input.name, "failed")
        await transitionExecutionStatus(input.teamName, input.name, "idle")
        await transitionMemberStatus(input.teamName, input.name, "error")
        await notifyLead(input.teamName, input.name, session.id, "errored", err.message)
      })

    return { sessionID: session.id, label }
  }

  /**
   * Approve or reject a teammate's plan. On approval, removes plan-approval
   * deny rules and notifies the teammate.
   */
  export async function approvePlan(input: {
    teamName: string
    memberName: string
    approved: boolean
    feedback?: string
  }): Promise<void> {
    const { Session } = await import("../session")
    const { TeamMessaging } = await import("./messaging")

    const team = await get(input.teamName)
    if (!team) throw new Error(`Team "${input.teamName}" not found`)

    const member = team.members.find((m) => m.name === input.memberName)
    if (!member) throw new Error(`Teammate "${input.memberName}" not found`)

    if (input.approved) {
      await Session.update(member.sessionID, (draft) => {
        if (draft.permission) {
          draft.permission = draft.permission.filter((rule) => rule.pattern !== "*:plan-approval")
        }
      })
      await setMemberPlanApproval(input.teamName, input.memberName, "approved")
      await TeamMessaging.send({
        teamName: input.teamName,
        from: "lead",
        to: input.memberName,
        text: input.feedback
          ? `Your plan has been APPROVED. You now have full write access. Feedback: ${input.feedback}`
          : "Your plan has been APPROVED. You now have full write access. Proceed with implementation.",
      })
    } else {
      await setMemberPlanApproval(input.teamName, input.memberName, "rejected")
      await TeamMessaging.send({
        teamName: input.teamName,
        from: "lead",
        to: input.memberName,
        text: `Your plan has been REJECTED. Please revise and resubmit. Feedback: ${input.feedback ?? "No specific feedback provided."}`,
      })
    }

    await Bus.publish(TeamEvent.PlanApproval, {
      teamName: input.teamName,
      memberName: input.memberName,
      approved: input.approved,
      feedback: input.feedback,
    })
  }

  /**
   * Notify the lead that a teammate's loop finished or errored.
   * Uses guard option because the lead may have already sent a shutdown request
   * (setting status to "shutdown") while the loop was finishing — without guard,
   * this would overwrite "shutdown" with "ready", preventing auto-cleanup.
   */
  async function notifyLead(
    teamName: string,
    name: string,
    sessionID: string,
    status: "completed" | "cancelled" | "errored",
    error?: string,
  ) {
    try {
      const { TeamMessaging } = await import("./messaging")

      const team = await get(teamName)
      if (!team) return

      const member = team.members.find((m) => m.name === name)
      if (member?.status === "shutdown") return

      const text =
        status === "cancelled"
          ? `I was interrupted by the lead and am now idle. Send me a message to resume work.`
          : status === "completed"
            ? `I have finished my current work and am now idle. Review my session (${sessionID}) for detailed results. You can use team_shutdown to shut me down if no more work is needed.`
            : `I encountered an error and stopped: ${error ?? "unknown error"}. Review my session (${sessionID}). You can use team_shutdown to shut me down, or send me a message to retry.`

      await TeamMessaging.send({
        teamName,
        from: name,
        to: "lead",
        text,
      })
    } catch (err: unknown) {
      log.warn("failed to notify lead of teammate completion", {
        teamName,
        name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Clean up a team — removes config and task data.
   * Fails if any members are still active.
   * Publishes TeamEvent.Cleaned so listeners can handle side-effects
   * (e.g. restoring lead session permissions).
   */
  export async function cleanup(teamName: string): Promise<void> {
    const team = await get(teamName)
    if (!team) throw new Error(`Team "${teamName}" not found`)

    const alive = team.members.filter((m) => m.status !== "shutdown")
    if (alive.length > 0) {
      throw new Error(
        `Cannot clean up team "${teamName}": ${alive.length} non-shutdown member(s): ${alive.map((m) => m.name).join(", ")}. Shut them down first.`,
      )
    }

    await Storage.remove(configKey(teamName))
    await Storage.remove(tasksKey(teamName))

    log.info("team cleaned up", { teamName })
    await Bus.publish(TeamEvent.Cleaned, {
      teamName,
      leadSessionID: team.leadSessionID,
      delegate: !!team.delegate,
    })
  }

  /**
   * Cancel a single teammate's prompt loop by calling SessionPrompt.cancel.
   * This mirrors how the Task tool propagates abort to subagents (task.ts:121-125).
   * Returns true if the member was found and cancelled.
   */
  export async function cancelMember(teamName: string, memberName: string): Promise<boolean> {
    const { SessionPrompt } = await import("../session/prompt")
    const { SessionStatus } = await import("../session/status")

    const team = await get(teamName)
    if (!team) return false

    const member = team.members.find((m) => m.name === memberName)
    if (!member) return false
    // Allow cancel for busy members and shutdown_requested members
    // (shutdown sets shutdown_requested before calling cancelMember,
    // so the member is no longer "busy" by the time we get here)
    if (member.status !== "busy" && member.status !== "shutdown_requested") return false
    if (TERMINAL_EXECUTION_STATES.has(member.execution_status ?? "idle")) return false

    log.info("cancelling member", { teamName, memberName, sessionID: member.sessionID })
    await transitionExecutionStatus(teamName, memberName, "cancel_requested")

    for (const _ of [0, 1, 2]) {
      SessionPrompt.cancel(member.sessionID)
      await transitionExecutionStatus(teamName, memberName, "cancelling")
      await Bun.sleep(120)
      const next = await get(teamName)
      const current = next?.members.find((m) => m.name === memberName)
      if (!current) break
      if (TERMINAL_EXECUTION_STATES.has(current.execution_status ?? "idle")) break
      if (current.status !== "busy" && current.status !== "shutdown_requested") break
    }

    const next = await get(teamName)
    const current = next?.members.find((m) => m.name === memberName)
    if (!current) return true
    if (TERMINAL_EXECUTION_STATES.has(current.execution_status ?? "idle")) return true

    const runtime = SessionStatus.get(member.sessionID)
    if (runtime.type !== "idle") return false

    await transitionExecutionStatus(teamName, memberName, "cancelled", { force: true })
    await transitionExecutionStatus(teamName, memberName, "idle", { force: true })
    if (current.status === "busy") {
      await transitionMemberStatus(teamName, memberName, "ready", { force: true })
    }
    return true
  }

  /**
   * Cancel all active teammates' prompt loops.
   * Returns the count of members that were cancelled.
   */
  export async function cancelAllMembers(teamName: string): Promise<number> {
    const { SessionPrompt } = await import("../session/prompt")

    const team = await get(teamName)
    if (!team) return 0

    let count = 0
    for (const member of team.members) {
      if (member.status !== "busy") continue
      if (TERMINAL_EXECUTION_STATES.has(member.execution_status ?? "idle")) continue
      log.info("cancelling member", { teamName, memberName: member.name, sessionID: member.sessionID })
      await transitionExecutionStatus(teamName, member.name, "cancel_requested")
      SessionPrompt.cancel(member.sessionID)
      await transitionExecutionStatus(teamName, member.name, "cancelling")
      count++
    }
    return count
  }

  /**
   * Mark teammates that were busy when the server died as cancelled
   * and inject a notification into the lead session.
   * Called once during InstanceBootstrap.
   */
  export async function recover(): Promise<{ interrupted: number }> {
    const teams = await list()
    let count = 0

    for (const team of teams) {
      const active = team.members.filter((m) => m.status === "busy")
      if (active.length === 0) continue

      log.info("marking interrupted teammates", { teamName: team.name, count: active.length })

      const names: string[] = []
      for (const member of active) {
        await transitionExecutionStatus(team.name, member.name, "cancelled", { force: true })
        await transitionExecutionStatus(team.name, member.name, "idle", { force: true })
        await transitionMemberStatus(team.name, member.name, "ready", { force: true })
        names.push(member.name)
        count++
      }

      try {
        const { Session } = await import("../session")
        const { Identifier } = await import("../id/id")
        const msgs = await Session.messages({ sessionID: team.leadSessionID })
        const lastUser = msgs.findLast((m) => m.info.role === "user")
        if (lastUser) {
          const info = lastUser.info as { agent: string; model: { providerID: string; modelID: string } }
          const msgId = Identifier.ascending("message")
          await Session.updateMessage({
            id: msgId,
            sessionID: team.leadSessionID,
            role: "user",
            agent: info.agent,
            model: info.model,
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: msgId,
            sessionID: team.leadSessionID,
            type: "text",
            text: `[System]: Server was restarted. The following teammates in team "${team.name}" were interrupted and need to be resumed: ${names.join(", ")}. Use team_message or team_broadcast to tell them to continue their work.`,
            synthetic: true,
          })
        }
      } catch (err: unknown) {
        log.warn("failed to notify lead of interrupted teammates", {
          teamName: team.name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (count > 0) log.info("team recovery complete", { interrupted: count })
    return { interrupted: count }
  }
}

export namespace TeamTasks {
  /**
   * Read all tasks for a team.
   */
  export async function list(teamName: string): Promise<TeamTask[]> {
    try {
      return await Storage.read<TeamTask[]>(tasksKey(teamName))
    } catch {
      return []
    }
  }

  /**
   * Write the full task list for a team (replaces).
   */
  export async function update(teamName: string, tasks: TeamTask[]): Promise<void> {
    const resolved = resolveDependencies(tasks)
    await Storage.write(tasksKey(teamName), resolved)
    await Bus.publish(TeamEvent.TaskUpdated, { teamName, tasks: resolved })
  }

  /**
   * Add tasks to the team's task list.
   */
  export async function add(teamName: string, newTasks: TeamTask[]): Promise<void> {
    const existing = await list(teamName)
    const resolved = resolveDependencies([...existing, ...newTasks])
    await Storage.write(tasksKey(teamName), resolved)
    await Bus.publish(TeamEvent.TaskUpdated, { teamName, tasks: resolved })
  }

  /**
   * Atomically claim a task. Returns true if claimed, false if already taken.
   */
  export async function claim(teamName: string, taskId: string, memberName: string): Promise<boolean> {
    let claimed = false
    try {
      await Storage.update<TeamTask[]>(tasksKey(teamName), (tasks) => {
        const task = tasks.find((t) => t.id === taskId)
        if (!task) return
        if (task.status !== "pending") return
        if (task.assignee) return

        if (task.depends_on?.length) {
          const unresolved = task.depends_on.some((depId) => {
            const dep = tasks.find((t) => t.id === depId)
            return !dep || (dep.status !== "completed" && dep.status !== "cancelled")
          })
          if (unresolved) return
        }

        task.status = "in_progress"
        task.assignee = memberName
        claimed = true
      })
    } catch {
      return false
    }

    if (claimed) await Bus.publish(TeamEvent.TaskClaimed, { teamName, taskId, memberName })
    return claimed
  }

  /**
   * Mark a task as completed.
   */
  export async function complete(teamName: string, taskId: string): Promise<void> {
    let tasks: TeamTask[] = []
    try {
      tasks = await Storage.update<TeamTask[]>(tasksKey(teamName), (draft) => {
        const task = draft.find((t) => t.id === taskId)
        if (task) task.status = "completed"
        const resolved = resolveDependencies(draft)
        // Mutate in-place — Storage.update serializes the original reference,
        // so reassignment (draft = resolved) wouldn't propagate
        draft.length = 0
        draft.push(...resolved)
      })
    } catch {
      return
    }
    await Bus.publish(TeamEvent.TaskUpdated, { teamName, tasks })
  }

  function resolveDependencies(tasks: TeamTask[]): TeamTask[] {
    const validIds = new Set(tasks.map((t) => t.id))

    return tasks.map((task) => {
      if (task.depends_on) {
        task = { ...task, depends_on: task.depends_on.filter((id) => validIds.has(id) && id !== task.id) }
      }
      if (!task.depends_on?.length) return task

      const unresolved = task.depends_on.some((depId) => {
        const dep = tasks.find((t) => t.id === depId)
        return !dep || (dep.status !== "completed" && dep.status !== "cancelled")
      })

      if (unresolved && task.status === "pending") return { ...task, status: "blocked" }
      if (!unresolved && task.status === "blocked") return { ...task, status: "pending" }
      return task
    })
  }
}
