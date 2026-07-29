import { and, asc, eq, inArray } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Team } from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionV2 } from "../session"
import { TeamMemberTable, TeamMessageTable, TeamTable, TeamTaskTable } from "./sql"

export { Team }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Team.NotFoundError", {
  teamID: Team.ID,
}) {}

export class MemberNotFoundError extends Schema.TaggedErrorClass<MemberNotFoundError>()("Team.MemberNotFoundError", {
  teamID: Team.ID,
  name: Schema.String,
}) {}

export class MemberExistsError extends Schema.TaggedErrorClass<MemberExistsError>()("Team.MemberExistsError", {
  teamID: Team.ID,
  name: Schema.String,
}) {}

type AddMemberInput = Omit<Team.Member, "time">
type AddTaskInput = Omit<Team.Task, "id" | "teamID" | "time">

export interface Interface {
  readonly create: (input: {
    id?: Team.ID
    name: string
    leadSessionID: Team.Info["leadSessionID"]
  }) => Effect.Effect<Team.Info, SessionV2.NotFoundError>
  readonly get: (teamID: Team.ID) => Effect.Effect<Team.Info, NotFoundError>
  readonly list: Effect.Effect<Team.Info[]>
  readonly forSession: (sessionID: Team.Member["sessionID"]) => Effect.Effect<Team.Info | undefined>
  readonly addMember: (input: {
    teamID: Team.ID
    member: AddMemberInput
  }) => Effect.Effect<Team.Member, NotFoundError | MemberExistsError | MemberNotFoundError | SessionV2.NotFoundError>
  readonly updateMember: (input: {
    teamID: Team.ID
    name: string
    status?: Team.MemberStatus
    currentTaskID?: Team.TaskID | null
    error?: string | null
  }) => Effect.Effect<Team.Member, NotFoundError | MemberNotFoundError>
  readonly messages: (input: {
    teamID: Team.ID
    to?: string
    undelivered?: boolean
  }) => Effect.Effect<Team.Message[], NotFoundError>
  readonly send: (input: {
    teamID: Team.ID
    from: string
    to: string
    text: string
  }) => Effect.Effect<Team.Message, NotFoundError>
  readonly deliver: (messageID: Team.MessageID) => Effect.Effect<void>
  readonly tasks: (teamID: Team.ID) => Effect.Effect<Team.Task[], NotFoundError>
  readonly addTask: (input: { teamID: Team.ID; task: AddTaskInput }) => Effect.Effect<Team.Task, NotFoundError>
  readonly claimTask: (input: {
    teamID: Team.ID
    taskID: Team.TaskID
    assignee: string
  }) => Effect.Effect<boolean, NotFoundError>
  readonly completeTask: (input: { teamID: Team.ID; taskID: Team.TaskID }) => Effect.Effect<void, NotFoundError>
  readonly recover: Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentTeam") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const sessions = yield* SessionV2.Service

    const members = Effect.fn("AgentTeam.members")(function* (teamID: Team.ID) {
      const rows = yield* db
        .select()
        .from(TeamMemberTable)
        .where(eq(TeamMemberTable.team_id, teamID))
        .orderBy(asc(TeamMemberTable.time_created), asc(TeamMemberTable.name))
        .all()
        .pipe(Effect.orDie)
      return rows.map(memberFromRow)
    })

    const get = Effect.fn("AgentTeam.get")(function* (teamID: Team.ID) {
      const row = yield* db.select().from(TeamTable).where(eq(TeamTable.id, teamID)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ teamID })
      return teamFromRow(row, yield* members(teamID))
    })

    const result = Service.of({
      create: Effect.fn("AgentTeam.create")(function* (input) {
        yield* sessions.get(input.leadSessionID)
        const id = input.id ?? Team.ID.create()
        const existing = yield* db.select().from(TeamTable).where(eq(TeamTable.id, id)).get().pipe(Effect.orDie)
        if (existing) return yield* get(id).pipe(Effect.orDie)
        const now = Date.now()
        yield* db
          .insert(TeamTable)
          .values({
            id,
            name: input.name,
            lead_session_id: input.leadSessionID,
            status: "active",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      }),
      get,
      list: Effect.gen(function* () {
        const rows = yield* db.select().from(TeamTable).orderBy(asc(TeamTable.time_created)).all().pipe(Effect.orDie)
        return yield* Effect.forEach(rows, (row) =>
          members(row.id).pipe(Effect.map((value) => teamFromRow(row, value))),
        )
      }),
      forSession: Effect.fn("AgentTeam.forSession")(function* (sessionID) {
        const member = yield* db
          .select({ teamID: TeamMemberTable.team_id })
          .from(TeamMemberTable)
          .where(eq(TeamMemberTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (member) return yield* get(member.teamID).pipe(Effect.orDie)
        const lead = yield* db
          .select({ teamID: TeamTable.id })
          .from(TeamTable)
          .where(eq(TeamTable.lead_session_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return lead ? yield* get(lead.teamID).pipe(Effect.orDie) : undefined
      }),
      addMember: Effect.fn("AgentTeam.addMember")(function* (input) {
        yield* get(input.teamID)
        yield* sessions.get(input.member.sessionID)
        const exists = yield* db
          .select({ name: TeamMemberTable.name })
          .from(TeamMemberTable)
          .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.name, input.member.name)))
          .get()
          .pipe(Effect.orDie)
        if (exists) return yield* new MemberExistsError({ teamID: input.teamID, name: input.member.name })
        const now = Date.now()
        yield* db
          .insert(TeamMemberTable)
          .values({
            team_id: input.teamID,
            name: input.member.name,
            session_id: input.member.sessionID,
            agent: input.member.agent,
            model: input.member.model,
            role: input.member.role,
            permission: input.member.permission,
            status: input.member.status,
            current_task_id: input.member.currentTaskID,
            error: input.member.error,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        const row = yield* memberRow(input.teamID, input.member.name)
        return memberFromRow(row)
      }),
      updateMember: Effect.fn("AgentTeam.updateMember")(function* (input) {
        yield* get(input.teamID)
        const updated = yield* db
          .update(TeamMemberTable)
          .set({
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.currentTaskID === undefined ? {} : { current_task_id: input.currentTaskID }),
            ...(input.error === undefined ? {} : { error: input.error }),
            time_updated: Date.now(),
          })
          .where(and(eq(TeamMemberTable.team_id, input.teamID), eq(TeamMemberTable.name, input.name)))
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!updated) return yield* new MemberNotFoundError({ teamID: input.teamID, name: input.name })
        return memberFromRow(updated)
      }),
      messages: Effect.fn("AgentTeam.messages")(function* (input) {
        yield* get(input.teamID)
        const conditions = [eq(TeamMessageTable.team_id, input.teamID)]
        if (input.to !== undefined) conditions.push(eq(TeamMessageTable.to_name, input.to))
        if (input.undelivered !== undefined) conditions.push(eq(TeamMessageTable.delivered, !input.undelivered))
        const rows = yield* db
          .select()
          .from(TeamMessageTable)
          .where(and(...conditions))
          .orderBy(asc(TeamMessageTable.time_created))
          .all()
          .pipe(Effect.orDie)
        return rows.map(messageFromRow)
      }),
      send: Effect.fn("AgentTeam.send")(function* (input) {
        yield* get(input.teamID)
        const id = Team.MessageID.create()
        const now = Date.now()
        yield* db
          .insert(TeamMessageTable)
          .values({
            id,
            team_id: input.teamID,
            from_name: input.from,
            to_name: input.to,
            body: input.text,
            delivered: false,
            time_created: now,
          })
          .run()
          .pipe(Effect.orDie)
        return Team.Message.make({
          id,
          teamID: input.teamID,
          from: input.from,
          to: input.to,
          text: input.text,
          delivered: false,
          time: { created: DateTime.makeUnsafe(now) },
        })
      }),
      deliver: Effect.fn("AgentTeam.deliver")(function* (messageID) {
        yield* db
          .update(TeamMessageTable)
          .set({ delivered: true, time_delivered: Date.now() })
          .where(eq(TeamMessageTable.id, messageID))
          .run()
          .pipe(Effect.orDie)
      }),
      tasks: Effect.fn("AgentTeam.tasks")(function* (teamID) {
        yield* get(teamID)
        return (yield* db
          .select()
          .from(TeamTaskTable)
          .where(eq(TeamTaskTable.team_id, teamID))
          .orderBy(asc(TeamTaskTable.time_created))
          .all()
          .pipe(Effect.orDie)).map(taskFromRow)
      }),
      addTask: Effect.fn("AgentTeam.addTask")(function* (input) {
        yield* get(input.teamID)
        const id = Team.TaskID.create()
        const now = Date.now()
        yield* db
          .insert(TeamTaskTable)
          .values({
            id,
            team_id: input.teamID,
            ...input.task,
            assignee: input.task.assignee,
            dependencies: [...input.task.dependencies],
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return Team.Task.make({
          id,
          teamID: input.teamID,
          ...input.task,
          time: { created: DateTime.makeUnsafe(now), updated: DateTime.makeUnsafe(now) },
        })
      }),
      claimTask: Effect.fn("AgentTeam.claimTask")(function* (input) {
        yield* get(input.teamID)
        const updated = yield* db
          .update(TeamTaskTable)
          .set({ status: "in_progress", assignee: input.assignee, time_updated: Date.now() })
          .where(
            and(
              eq(TeamTaskTable.id, input.taskID),
              eq(TeamTaskTable.team_id, input.teamID),
              eq(TeamTaskTable.status, "pending"),
            ),
          )
          .returning({ id: TeamTaskTable.id })
          .get()
          .pipe(Effect.orDie)
        return updated !== undefined
      }),
      completeTask: Effect.fn("AgentTeam.completeTask")(function* (input) {
        yield* get(input.teamID)
        yield* db
          .update(TeamTaskTable)
          .set({ status: "completed", time_updated: Date.now() })
          .where(and(eq(TeamTaskTable.id, input.taskID), eq(TeamTaskTable.team_id, input.teamID)))
          .run()
          .pipe(Effect.orDie)
      }),
      recover: Effect.gen(function* () {
        const active = yield* db
          .select({ teamID: TeamMemberTable.team_id, name: TeamMemberTable.name })
          .from(TeamMemberTable)
          .where(inArray(TeamMemberTable.status, ["starting", "busy"]))
          .all()
          .pipe(Effect.orDie)
        if (active.length === 0) return 0
        yield* db
          .update(TeamMemberTable)
          .set({
            status: "interrupted",
            error: "OpenCode restarted while this teammate was active",
            time_updated: Date.now(),
          })
          .where(inArray(TeamMemberTable.status, ["starting", "busy"]))
          .run()
          .pipe(Effect.orDie)
        return active.length
      }),
    })

    function memberRow(teamID: Team.ID, name: string) {
      return db
        .select()
        .from(TeamMemberTable)
        .where(and(eq(TeamMemberTable.team_id, teamID), eq(TeamMemberTable.name, name)))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : new MemberNotFoundError({ teamID, name }))),
        )
    }
    return result
  }),
)

const memberFromRow = (row: typeof TeamMemberTable.$inferSelect) =>
  Team.Member.make({
    name: row.name,
    sessionID: row.session_id,
    agent: row.agent,
    model: row.model,
    role: row.role,
    permission: row.permission,
    status: row.status,
    currentTaskID: row.current_task_id ?? undefined,
    error: row.error ?? undefined,
    time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
  })
const teamFromRow = (row: typeof TeamTable.$inferSelect, members: Team.Member[]) =>
  Team.Info.make({
    id: row.id,
    name: row.name,
    leadSessionID: row.lead_session_id,
    status: row.status,
    members,
    time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
  })
const messageFromRow = (row: typeof TeamMessageTable.$inferSelect) =>
  Team.Message.make({
    id: row.id,
    teamID: row.team_id,
    from: row.from_name,
    to: row.to_name,
    text: row.body,
    delivered: row.delivered,
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      delivered: row.time_delivered === null ? undefined : DateTime.makeUnsafe(row.time_delivered),
    },
  })
const taskFromRow = (row: typeof TeamTaskTable.$inferSelect) =>
  Team.Task.make({
    id: row.id,
    teamID: row.team_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignee: row.assignee ?? undefined,
    dependencies: row.dependencies,
    time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
  })

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [Database.node, SessionV2.node],
})
