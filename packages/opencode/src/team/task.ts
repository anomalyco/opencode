import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq } from "../storage/db"
import { TeamTaskTable } from "./team.sql"
import { TeamID, TeamTaskID } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "team.task" })

export namespace TeamTask {
  export const Info = z
    .object({
      id: TeamTaskID.zod,
      teamID: TeamID.zod,
      subject: z.string(),
      description: z.string().optional(),
      owner: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed", "failed"]),
      metadata: z.record(z.string(), z.unknown()).optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "TeamTask" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "team.task.created",
      z.object({
        task: Info,
      }),
    ),
    Updated: BusEvent.define(
      "team.task.updated",
      z.object({
        task: Info,
      }),
    ),
  }

  function toInfo(row: typeof TeamTaskTable.$inferSelect): Info {
    return {
      id: row.id,
      teamID: row.team_id,
      subject: row.subject,
      description: row.description ?? undefined,
      owner: row.owner ?? undefined,
      status: row.status as Info["status"],
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  export function create(input: {
    teamID: TeamID
    subject: string
    description?: string
    owner?: string
    metadata?: Record<string, unknown>
  }): Info {
    const id = TeamTaskID.ascending()
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .insert(TeamTaskTable)
        .values({
          id,
          team_id: input.teamID,
          subject: input.subject,
          description: input.description,
          owner: input.owner,
          metadata: input.metadata,
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get(),
    )
    const info = toInfo(row)
    log.info("created", { id: info.id, subject: info.subject })
    Database.effect(() => Bus.publish(Event.Created, { task: info }))
    return info
  }

  export function update(
    id: TeamTaskID,
    input: Partial<Pick<Info, "status" | "owner" | "description" | "metadata">>,
  ): Info | undefined {
    const now = Date.now()
    const values: Record<string, unknown> = { time_updated: now }
    if (input.status !== undefined) values.status = input.status
    if (input.owner !== undefined) values.owner = input.owner
    if (input.description !== undefined) values.description = input.description
    if (input.metadata !== undefined) values.metadata = input.metadata

    Database.use((db) =>
      db.update(TeamTaskTable).set(values).where(eq(TeamTaskTable.id, id)).run(),
    )
    const updated = get(id)
    if (updated) {
      Database.effect(() => Bus.publish(Event.Updated, { task: updated }))
    }
    return updated
  }

  export function get(id: TeamTaskID): Info | undefined {
    const row = Database.use((db) =>
      db.select().from(TeamTaskTable).where(eq(TeamTaskTable.id, id)).get(),
    )
    if (!row) return undefined
    return toInfo(row)
  }

  export function list(teamID: TeamID): Info[] {
    const rows = Database.use((db) =>
      db.select().from(TeamTaskTable).where(eq(TeamTaskTable.team_id, teamID)).all(),
    )
    return rows.map(toInfo)
  }
}
