import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq, and, inArray } from "../storage/db"
import { TeamTable, TeamMemberTable, TeamTaskTable } from "./team.sql"
import { TeamID } from "./schema"
import { SessionID } from "../session/schema"
import { Log } from "../util/log"

const log = Log.create({ service: "team" })

export namespace Team {
  export const Info = z
    .object({
      id: TeamID.zod,
      sessionID: SessionID.zod,
      name: z.string(),
      status: z.enum(["active", "disbanded"]),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "Team" })
  export type Info = z.infer<typeof Info>

  export const Member = z
    .object({
      teamID: TeamID.zod,
      sessionID: SessionID.zod,
      agent: z.string(),
      role: z.enum(["lead", "member"]),
      status: z.enum(["active", "completed", "failed", "cancelled"]),
    })
    .meta({ ref: "TeamMember" })
  export type Member = z.infer<typeof Member>

  export const Event = {
    Created: BusEvent.define(
      "team.created",
      z.object({
        team: Info,
      }),
    ),
    Updated: BusEvent.define(
      "team.updated",
      z.object({
        team: Info,
      }),
    ),
    Disbanded: BusEvent.define(
      "team.disbanded",
      z.object({
        teamID: TeamID.zod,
      }),
    ),
    MemberAdded: BusEvent.define(
      "team.member.added",
      z.object({
        member: Member,
      }),
    ),
    MemberUpdated: BusEvent.define(
      "team.member.updated",
      z.object({
        member: Member,
      }),
    ),
  }

  function toInfo(row: typeof TeamTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      name: row.name,
      status: row.status as Info["status"],
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  function toMember(row: typeof TeamMemberTable.$inferSelect): Member {
    return {
      teamID: row.team_id,
      sessionID: row.session_id,
      agent: row.agent,
      role: row.role as Member["role"],
      status: row.status as Member["status"],
    }
  }

  export function create(input: { name: string; sessionID: SessionID; agent?: string }): Info {
    const id = TeamID.ascending()
    const now = Date.now()
    const row = Database.transaction((db) => {
      const row = db
        .insert(TeamTable)
        .values({
          id,
          session_id: input.sessionID,
          name: input.name,
          status: "active",
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get()
      // Add the lead as first member
      db.insert(TeamMemberTable)
        .values({
          team_id: id,
          session_id: input.sessionID,
          agent: input.agent ?? "lead",
          role: "lead",
          status: "active",
          time_created: now,
          time_updated: now,
        })
        .run()
      return row
    })
    const info = toInfo(row)
    log.info("created", { id: info.id, name: info.name })
    Database.effect(() => Bus.publish(Event.Created, { team: info }))
    return info
  }

  export function disband(id: TeamID) {
    const now = Date.now()
    Database.transaction((db) => {
      db.update(TeamTable).set({ status: "disbanded", time_updated: now }).where(eq(TeamTable.id, id)).run()
      db.update(TeamMemberTable)
        .set({ status: "cancelled", time_updated: now })
        .where(and(eq(TeamMemberTable.team_id, id), eq(TeamMemberTable.status, "active")))
        .run()
      // Cascade: mark in-progress and pending tasks as failed
      db.update(TeamTaskTable)
        .set({ status: "failed", time_updated: now })
        .where(and(eq(TeamTaskTable.team_id, id), inArray(TeamTaskTable.status, ["in_progress", "pending"])))
        .run()
    })
    log.info("disbanded", { id })
    Database.effect(() => Bus.publish(Event.Disbanded, { teamID: id }))
  }

  export function get(id: TeamID): Info | undefined {
    const row = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.id, id)).get())
    if (!row) return undefined
    return toInfo(row)
  }

  export function bySession(sessionID: SessionID): Info[] {
    const rows = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.session_id, sessionID)).all())
    return rows.map(toInfo)
  }

  export function members(id: TeamID): Member[] {
    const rows = Database.use((db) => db.select().from(TeamMemberTable).where(eq(TeamMemberTable.team_id, id)).all())
    return rows.map(toMember)
  }

  export function addMember(input: { teamID: TeamID; sessionID: SessionID; agent: string }): Member {
    const team = get(input.teamID)
    if (!team) throw new Error(`Team not found: ${input.teamID}`)
    if (team.status === "disbanded") throw new Error(`Cannot add member to disbanded team: ${input.teamID}`)

    // Disambiguate duplicate agent names by appending a suffix
    let agent = input.agent
    const existing = members(input.teamID).filter((m) => m.role === "member")
    const taken = new Set(existing.map((m) => m.agent))
    if (taken.has(agent)) {
      let i = 2
      while (taken.has(`${input.agent}-${i}`)) i++
      agent = `${input.agent}-${i}`
    }

    const now = Date.now()
    const row = Database.use((db) =>
      db
        .insert(TeamMemberTable)
        .values({
          team_id: input.teamID,
          session_id: input.sessionID,
          agent,
          role: "member",
          status: "active",
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get(),
    )
    const member = toMember(row)
    Database.effect(() => Bus.publish(Event.MemberAdded, { member }))
    return member
  }

  export function updateMember(input: { teamID: TeamID; sessionID: SessionID; status: Member["status"] }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .update(TeamMemberTable)
        .set({ status: input.status, time_updated: now })
        .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
        .run(),
    )
  }

  export function findMemberSession(input: { teamID: TeamID; agent: string }): Member | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.agent, input.agent)))
        .get(),
    )
    if (!row) return undefined
    return toMember(row)
  }

  export function leadSession(id: TeamID): Member | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .where(and(eq(TeamMemberTable.team_id, id), eq(TeamMemberTable.role, "lead")))
        .get(),
    )
    if (!row) return undefined
    return toMember(row)
  }

  /** Mark a member as completed (normal exit) */
  export function completeMember(sessionID: SessionID) {
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .where(and(eq(TeamMemberTable.session_id, sessionID), eq(TeamMemberTable.status, "active")))
        .get(),
    )
    if (!row) return
    Database.use((db) =>
      db
        .update(TeamMemberTable)
        .set({ status: "completed", time_updated: now })
        .where(and(eq(TeamMemberTable.session_id, sessionID), eq(TeamMemberTable.status, "active")))
        .run(),
    )
    const member = toMember({ ...row, status: "completed" })
    Database.effect(() => Bus.publish(Event.MemberUpdated, { member }))
  }

  /** Disband all active teams owned by a session (cleanup on session end) */
  export function disbandBySession(sessionID: SessionID) {
    const teams = bySession(sessionID).filter((t) => t.status === "active")
    for (const team of teams) {
      log.info("auto-disbanding on session end", { teamID: team.id, sessionID })
      disband(team.id)
    }
  }

  /** Mark a member as failed and cascade failure to owned team tasks */
  export function failMember(input: { teamID: TeamID; sessionID: SessionID; agent: string }) {
    const now = Date.now()
    Database.transaction((db) => {
      db.update(TeamMemberTable)
        .set({ status: "failed", time_updated: now })
        .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.session_id, input.sessionID)))
        .run()
      // Cascade: mark in-progress tasks owned by this agent as failed
      db.update(TeamTaskTable)
        .set({ status: "failed", time_updated: now })
        .where(
          and(
            eq(TeamTaskTable.team_id, input.teamID),
            eq(TeamTaskTable.owner, input.agent),
            eq(TeamTaskTable.status, "in_progress"),
          ),
        )
        .run()
    })
    const member = findMemberSession({ teamID: input.teamID, agent: input.agent })
    if (member) Database.effect(() => Bus.publish(Event.MemberUpdated, { member }))
  }

  /** Reconcile stale teams on startup — mark active teams as disbanded */
  export function reconcile() {
    const now = Date.now()
    const stale = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.status, "active")).all())
    for (const row of stale) {
      log.info("reconciling stale team", { id: row.id, name: row.name })
      disband(row.id as TeamID)
    }
    if (stale.length > 0) log.info("reconciled teams", { count: stale.length })
  }

  /** List all active teams (across all sessions) */
  export function active(): Info[] {
    const rows = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.status, "active")).all())
    return rows.map(toInfo)
  }
}
