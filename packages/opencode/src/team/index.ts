import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { SessionTable } from "@/session/session.sql"
import { TeamTable } from "./team.sql"
import { TeamTaskTable } from "./team-task.sql"
import { TeamMessageTable } from "./team-message.sql"
import { Log } from "@/util/log"

export namespace Team {
  const log = Log.create({ service: "team" })

  export const Info = z.object({
    id: z.string(),
    name: z.string(),
    leadSessionID: z.string(),
    status: z.enum(["active", "archived"]),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define("team.created", z.object({ info: Info })),
    Archived: BusEvent.define("team.archived", z.object({ info: Info })),
    MemberJoined: BusEvent.define(
      "team.member.joined",
      z.object({
        teamID: z.string(),
        sessionID: z.string(),
        role: z.enum(["lead", "member"]),
      }),
    ),
    MemberLeft: BusEvent.define(
      "team.member.left",
      z.object({
        teamID: z.string(),
        sessionID: z.string(),
      }),
    ),
    TeammateIdle: BusEvent.define(
      "team.teammate.idle",
      z.object({
        teamID: z.string(),
        sessionID: z.string(),
      }),
    ),
    Message: BusEvent.define(
      "team.message",
      z.object({
        teamID: z.string(),
        messageID: z.string(),
        fromSessionID: z.string(),
        toSessionID: z.string().nullable(),
        content: z.string(),
      }),
    ),
    TaskCompleted: BusEvent.define(
      "team.task.completed",
      z.object({
        teamID: z.string(),
        taskID: z.string(),
        sessionID: z.string(),
      }),
    ),
    TaskCreated: BusEvent.define(
      "team.task.created",
      z.object({
        teamID: z.string(),
        taskID: z.string(),
      }),
    ),
    TaskClaimed: BusEvent.define(
      "team.task.claimed",
      z.object({
        teamID: z.string(),
        taskID: z.string(),
        sessionID: z.string(),
      }),
    ),
  }

  function fromRow(row: typeof TeamTable.$inferSelect): Info {
    return {
      id: row.id,
      name: row.name,
      leadSessionID: row.lead_session_id,
      status: row.status,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  async function publishSessionUpdated(sessionID: string) {
    const { Session: SessionModule } = await import("@/session")
    const sessionRow = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    if (sessionRow) {
      await Bus.publish(SessionModule.Event.Updated, { info: SessionModule.fromRow(sessionRow) })
    }
  }

  export async function create(input: { name: string; sessionID: string }) {
    const existing = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
    )
    if (existing?.team_id) throw new Error("Session is already in a team")

    const id = Identifier.ascending("team")
    const now = Date.now()
    const row = Database.use((db) => {
      db.insert(TeamTable)
        .values({
          id,
          name: input.name,
          lead_session_id: input.sessionID,
          status: "active",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.update(SessionTable).set({ team_id: id, team_role: "lead" }).where(eq(SessionTable.id, input.sessionID)).run()
      return db.select().from(TeamTable).where(eq(TeamTable.id, id)).get()
    })
    if (!row) throw new Error("Failed to create team")
    const info = fromRow(row)
    log.info("created", { id, name: input.name })
    await Bus.publish(Event.Created, { info })
    await Bus.publish(Event.MemberJoined, {
      teamID: id,
      sessionID: input.sessionID,
      role: "lead",
    })

    // Publish session.updated event so TUI can update teamID
    await publishSessionUpdated(input.sessionID)

    return info
  }

  export async function get(id: string) {
    const row = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.id, id)).get())
    if (!row) throw new Error(`Team not found: ${id}`)
    return fromRow(row)
  }

  export async function list() {
    const rows = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.status, "active")).all())
    return rows.map(fromRow)
  }

  export async function members(teamID: string) {
    return Database.use((db) =>
      db
        .select({
          id: SessionTable.id,
          title: SessionTable.title,
          team_role: SessionTable.team_role,
          time_updated: SessionTable.time_updated,
        })
        .from(SessionTable)
        .where(eq(SessionTable.team_id, teamID))
        .all(),
    )
  }

  export async function status(teamID: string) {
    const info = await get(teamID)
    const teamMembers = await members(teamID)
    const tasks = Database.use((db) => db.select().from(TeamTaskTable).where(eq(TeamTaskTable.team_id, teamID)).all())
    return {
      ...info,
      members: teamMembers,
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        in_progress: tasks.filter((t) => t.status === "in_progress").length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    }
  }

  export async function archive(teamID: string) {
    const row = Database.use((db) =>
      db
        .update(TeamTable)
        .set({ status: "archived", time_updated: Date.now() })
        .where(eq(TeamTable.id, teamID))
        .returning()
        .get(),
    )
    if (!row) throw new Error(`Team not found: ${teamID}`)
    const info = fromRow(row)
    log.info("archived", { id: teamID })
    await Bus.publish(Event.Archived, { info })
    return info
  }

  export async function cleanup(teamID: string, leadSessionID: string) {
    const info = await get(teamID)
    if (info.leadSessionID !== leadSessionID) throw new Error("Only the lead session can clean up the team")

    const active = await members(teamID)
    const running = active.filter((m) => m.team_role === "member" && SessionPromptState.isRunning(m.id))
    if (running.length > 0)
      throw new Error(`Cannot cleanup: ${running.length} teammate(s) still running. Shut them down first.`)

    log.info("cleanup team", { teamID, memberCount: active.length })

    const { Session: SessionModule } = await import("@/session")
    const memberSessions = active.filter((m) => m.team_role === "member")
    for (const m of memberSessions) {
      try {
        await SessionModule.remove(m.id)
        log.info("removed member session", { sessionID: m.id, title: m.title })
      } catch (e) {
        log.error("failed to remove member session", { sessionID: m.id, title: m.title, error: String(e) })
        // Continue with cleanup even if one member fails
      }
    }

    Database.use((db) => {
      db.update(SessionTable).set({ team_id: null, team_role: null }).where(eq(SessionTable.team_id, teamID)).run()
    })

    // Publish session.updated event for lead session so TUI can update teamID
    await publishSessionUpdated(leadSessionID)

    log.info("team cleaned up", { teamID })
    return archive(teamID)
  }

  export async function join(teamID: string, sessionID: string) {
    Database.use((db) => {
      db.update(SessionTable).set({ team_id: teamID, team_role: "member" }).where(eq(SessionTable.id, sessionID)).run()
    })
    await Bus.publish(Event.MemberJoined, {
      teamID,
      sessionID,
      role: "member",
    })

    // Publish session.updated event so TUI can update teamID
    await publishSessionUpdated(sessionID)
  }

  export async function leave(sessionID: string) {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    if (!row?.team_id) return
    const teamID = row.team_id
    Database.use((db) => {
      db.update(SessionTable).set({ team_id: null, team_role: null }).where(eq(SessionTable.id, sessionID)).run()
    })
    await Bus.publish(Event.MemberLeft, { teamID, sessionID })

    // Publish session.updated event so TUI can update teamID
    await publishSessionUpdated(sessionID)
  }

  export function getBySession(sessionID: string) {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    const teamID = row?.team_id
    if (!teamID) return undefined
    const team = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.id, teamID)).get())
    if (!team) return undefined
    return fromRow(team)
  }
}

export namespace SessionPromptState {
  const running = new Set<string>()

  export function mark(sessionID: string) {
    running.add(sessionID)
  }

  export function unmark(sessionID: string) {
    running.delete(sessionID)
  }

  export function isRunning(sessionID: string) {
    return running.has(sessionID)
  }
}
