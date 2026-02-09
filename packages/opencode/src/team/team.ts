import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { TaskBoard } from "./task-board"
import { TeamMessageBus } from "./message-bus"
import { FileClaim } from "./file-claim"

export namespace Team {
  const log = Log.create({ service: "team" })

  export const TeammateInfo = z
    .object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      sessionID: z.string(),
      status: z.enum(["idle", "working", "paused", "completed", "failed"]),
    })
    .meta({ ref: "Teammate" })
  export type TeammateInfo = z.infer<typeof TeammateInfo>

  export const Info = z
    .object({
      id: z.string(),
      parentSessionID: z.string(),
      status: z.enum(["running", "paused", "completed", "failed"]),
      lead: TeammateInfo,
      teammates: z.array(TeammateInfo),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        completed: z.number().optional(),
      }),
    })
    .meta({ ref: "Team" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "team.created",
      z.object({ team: Info }),
    ),
    Updated: BusEvent.define(
      "team.updated",
      z.object({ team: Info }),
    ),
    TeammateStatus: BusEvent.define(
      "team.teammate.status",
      z.object({
        teamID: z.string(),
        teammateID: z.string(),
        status: TeammateInfo.shape.status,
      }),
    ),
    Completed: BusEvent.define(
      "team.completed",
      z.object({ team: Info }),
    ),
  }

  // In-memory tracking of active teams for pause/resume
  const active = Instance.state(() => {
    const data: Record<
      string,
      {
        abort: AbortController
        promises: Promise<void>[]
      }
    > = {}
    return data
  })

  export async function create(input: {
    parentSessionID: string
    teammates: Array<{
      name: string
      role: string
      model?: { providerID: string; modelID: string }
    }>
    tasks: Array<{
      title: string
      description: string
      dependencies?: string[]
    }>
    model?: { providerID: string; modelID: string }
  }) {
    const teamID = Identifier.ascending("team")

    // Create lead teammate entry
    const leadSession = await Session.create({
      parentID: input.parentSessionID,
      title: `Team ${teamID} - Lead`,
    })
    const lead: TeammateInfo = {
      id: Identifier.ascending("teammate"),
      name: "lead",
      role: "Team lead: coordinates teammates, distributes work, aggregates results",
      sessionID: leadSession.id,
      status: "idle",
    }

    // Create teammate sessions in parallel
    const teammates = await Promise.all(
      input.teammates.map(async (spec) => {
        const session = await Session.create({
          parentID: input.parentSessionID,
          title: `Team ${teamID} - ${spec.name}`,
        })
        const teammate: TeammateInfo = {
          id: Identifier.ascending("teammate"),
          name: spec.name,
          role: spec.role,
          model: spec.model,
          sessionID: session.id,
          status: "idle",
        }
        return teammate
      }),
    )

    const team: Info = {
      id: teamID,
      parentSessionID: input.parentSessionID,
      status: "running",
      lead,
      teammates,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }

    await Storage.write(["team", teamID], team)

    // Create tasks on the board
    for (const task of input.tasks) {
      await TaskBoard.add({
        teamID,
        title: task.title,
        description: task.description,
        dependencies: task.dependencies,
      })
    }

    log.info("team created", { teamID, teammateCount: teammates.length, taskCount: input.tasks.length })
    Bus.publish(Event.Created, { team })
    return team
  }

  export async function get(teamID: string) {
    return Storage.read<Info>(["team", teamID])
  }

  async function update(teamID: string, editor: (team: Info) => void) {
    const team = await get(teamID)
    editor(team)
    team.time.updated = Date.now()
    await Storage.write(["team", teamID], team)
    Bus.publish(Event.Updated, { team })
    return team
  }

  export async function setTeammateStatus(teamID: string, teammateID: string, status: TeammateInfo["status"]) {
    const team = await update(teamID, (t) => {
      if (t.lead.id === teammateID) {
        t.lead.status = status
        return
      }
      const mate = t.teammates.find((m) => m.id === teammateID)
      if (mate) mate.status = status
    })
    Bus.publish(Event.TeammateStatus, { teamID, teammateID, status })
    return team
  }

  export async function run(input: {
    teamID: string
    model: { providerID: string; modelID: string }
    abort: AbortSignal
  }) {
    const team = await get(input.teamID)
    const controller = new AbortController()
    const combinedAbort = () => controller.abort()
    input.abort.addEventListener("abort", combinedAbort)

    active()[input.teamID] = {
      abort: controller,
      promises: [],
    }

    try {
      // Run all teammates in parallel
      const promises = team.teammates.map((teammate) =>
        runTeammate({
          teamID: input.teamID,
          teammate,
          model: teammate.model ?? input.model,
          abort: controller.signal,
        }).catch((err) => {
          log.error("teammate failed", { teamID: input.teamID, teammate: teammate.name, error: err })
          setTeammateStatus(input.teamID, teammate.id, "failed")
        }),
      )

      active()[input.teamID].promises = promises
      await Promise.all(promises)

      // Check if all tasks are done
      const tasks = await TaskBoard.list(input.teamID)
      const allDone = TaskBoard.isAllDone(tasks)

      const finalTeam = await update(input.teamID, (t) => {
        t.status = allDone ? "completed" : "failed"
        t.time.completed = Date.now()
      })

      Bus.publish(Event.Completed, { team: finalTeam })
      return finalTeam
    } finally {
      input.abort.removeEventListener("abort", combinedAbort)
      delete active()[input.teamID]
    }
  }

  async function runTeammate(input: {
    teamID: string
    teammate: TeammateInfo
    model: { providerID: string; modelID: string }
    abort: AbortSignal
  }) {
    const { teamID, teammate, model, abort } = input

    await setTeammateStatus(teamID, teammate.id, "working")

    const tasks = await TaskBoard.list(teamID)
    const allTeammates = (await get(teamID)).teammates
    const messages = await TeamMessageBus.list(teamID)

    const systemContext = buildTeammatePrompt({
      teammate,
      teamID,
      tasks,
      teammates: allTeammates,
      messages,
    })

    const messageID = Identifier.ascending("message")

    const promptParts = await SessionPrompt.resolvePromptParts(systemContext)

    await SessionPrompt.prompt({
      messageID,
      sessionID: teammate.sessionID,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      agent: "general",
      parts: promptParts,
    })

    // After the teammate finishes, post a status update
    await TeamMessageBus.send({
      teamID,
      from: teammate.id,
      to: "lead",
      content: `[${teammate.name}] finished working. Status: completed.`,
    })

    await setTeammateStatus(teamID, teammate.id, "completed")
    await FileClaim.releaseAll({ teamID, owner: teammate.id })
  }

  function buildTeammatePrompt(input: {
    teammate: TeammateInfo
    teamID: string
    tasks: TaskBoard.Task[]
    teammates: TeammateInfo[]
    messages: TeamMessageBus.Message[]
  }) {
    const { teammate, teamID, tasks, teammates, messages } = input

    const myTasks = tasks.filter((t) => !t.owner || t.owner === teammate.id)
    const availableTasks = tasks.filter((t) => {
      if (t.status !== "pending") return false
      return t.dependencies.every((depID) => {
        const dep = tasks.find((d) => d.id === depID)
        return dep?.status === "completed"
      })
    })

    const recentMessages = messages.slice(-20)

    const lines = [
      `# Agent Team Assignment`,
      ``,
      `You are **${teammate.name}**, a teammate in team \`${teamID}\`.`,
      `Your role: ${teammate.role}`,
      ``,
      `## Team Members`,
      ...teammates.map((m) => `- **${m.name}** (${m.id}): ${m.role} [${m.status}]`),
      ``,
      `## Team Discipline`,
      `- Claim tasks before working on them`,
      `- Claim files before editing them to avoid conflicts with other teammates`,
      `- Post frequent status updates via messages`,
      `- Complete your assigned tasks fully before moving on`,
      `- If blocked, message the lead or relevant teammate`,
      ``,
      `## Task Board`,
      `### Available Tasks (unclaimed, dependencies met):`,
      ...(availableTasks.length > 0
        ? availableTasks.map(
            (t) =>
              `- [${t.id}] **${t.title}**: ${t.description}${t.dependencies.length > 0 ? ` (depends on: ${t.dependencies.join(", ")})` : ""}`,
          )
        : ["- No available tasks"]),
      ``,
      `### All Tasks:`,
      ...tasks.map(
        (t) =>
          `- [${t.id}] **${t.title}** | status: ${t.status} | owner: ${t.owner ?? "unassigned"}${t.result ? ` | result: ${t.result.slice(0, 200)}` : ""}`,
      ),
      ``,
      `## Recent Team Messages`,
      ...(recentMessages.length > 0
        ? recentMessages.map((m) => `- [${new Date(m.time).toISOString()}] ${m.from} -> ${m.to}: ${m.content}`)
        : ["- No messages yet"]),
      ``,
      `## Your Instructions`,
      `1. Review the available tasks on the task board`,
      `2. Pick a task that matches your role and claim it`,
      `3. Work on the task using any tools available to you`,
      `4. When done, mark the task as completed with your result`,
      `5. Check if there are more tasks you can work on`,
      `6. If all your tasks are done, send a completion message to the lead`,
      ``,
      `You have full access to all tools. Use them freely to accomplish your tasks.`,
      `Focus on your role and assigned tasks. Coordinate with teammates through messages.`,
    ]

    return lines.join("\n")
  }

  export async function pause(teamID: string) {
    const entry = active()[teamID]
    if (!entry) throw new Error(`Team ${teamID} is not active`)

    entry.abort.abort()
    await update(teamID, (t) => {
      t.status = "paused"
      for (const m of t.teammates) {
        if (m.status === "working") m.status = "paused"
      }
    })
    delete active()[teamID]

    log.info("team paused", { teamID })
  }

  export async function resume(input: {
    teamID: string
    model: { providerID: string; modelID: string }
    abort: AbortSignal
  }) {
    const team = await update(input.teamID, (t) => {
      t.status = "running"
    })

    // Resume paused teammates
    const pausedMates = team.teammates.filter((m) => m.status === "paused" || m.status === "idle")
    if (pausedMates.length === 0) {
      log.info("no teammates to resume", { teamID: input.teamID })
      return team
    }

    return run({
      teamID: input.teamID,
      model: input.model,
      abort: input.abort,
    })
  }

  export async function status(teamID: string) {
    const team = await get(teamID)
    const tasks = await TaskBoard.list(teamID)
    const messages = await TeamMessageBus.list(teamID)
    const claims = await FileClaim.list(teamID)

    return {
      team,
      tasks,
      messageCount: messages.length,
      recentMessages: messages.slice(-10),
      fileClaims: claims,
      progress: {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === "completed").length,
        inProgress: tasks.filter((t) => t.status === "in_progress").length,
        pending: tasks.filter((t) => t.status === "pending").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        blocked: tasks.filter((t) => t.status === "blocked").length,
      },
    }
  }
}
