import { Database, eq, and, isNull, or, inArray } from "@/storage/db"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { TeamMessageTable } from "./team-message.sql"
import { Team } from "./index"
import { Log } from "@/util/log"

export namespace TeamMessage {
  const log = Log.create({ service: "team-message" })

  export type Info = typeof TeamMessageTable.$inferSelect

  export async function send(input: { teamID: string; fromSessionID: string; toSessionID: string; content: string }) {
    const id = Identifier.ascending("team_message")
    const now = Date.now()
    Database.use((db) => {
      db.insert(TeamMessageTable)
        .values({
          id,
          team_id: input.teamID,
          from_session_id: input.fromSessionID,
          to_session_id: input.toSessionID,
          content: input.content,
          read: false,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    log.info("sent", { id, from: input.fromSessionID, to: input.toSessionID })
    await Bus.publish(Team.Event.Message, {
      teamID: input.teamID,
      messageID: id,
      fromSessionID: input.fromSessionID,
      toSessionID: input.toSessionID,
      content: input.content,
    })
    return id
  }

  export async function broadcast(input: { teamID: string; fromSessionID: string; content: string }) {
    const id = Identifier.ascending("team_message")
    const now = Date.now()
    Database.use((db) => {
      db.insert(TeamMessageTable)
        .values({
          id,
          team_id: input.teamID,
          from_session_id: input.fromSessionID,
          to_session_id: null,
          content: input.content,
          read: false,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    log.info("broadcast", { id, from: input.fromSessionID })
    await Bus.publish(Team.Event.Message, {
      teamID: input.teamID,
      messageID: id,
      fromSessionID: input.fromSessionID,
      toSessionID: null,
      content: input.content,
    })
    return id
  }

  export function list(teamID: string) {
    return Database.use((db) => db.select().from(TeamMessageTable).where(eq(TeamMessageTable.team_id, teamID)).all())
  }

  export function pending(sessionID: string, teamID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(TeamMessageTable)
        .where(
          and(
            eq(TeamMessageTable.team_id, teamID),
            eq(TeamMessageTable.read, false),
            or(eq(TeamMessageTable.to_session_id, sessionID), isNull(TeamMessageTable.to_session_id)),
          ),
        )
        .all()
        .filter((m) => m.from_session_id !== sessionID),
    )
  }

  export function markRead(ids: string[]) {
    if (ids.length === 0) return
    Database.use((db) => {
      db.update(TeamMessageTable)
        .set({ read: true, time_updated: Date.now() })
        .where(inArray(TeamMessageTable.id, ids))
        .run()
    })
  }
}
