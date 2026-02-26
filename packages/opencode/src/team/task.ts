import { Database, eq, and } from "@/storage/db"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { TeamTaskTable } from "./team-task.sql"
import { Team } from "./index"
import { Log } from "@/util/log"

export namespace TeamTask {
  const log = Log.create({ service: "team-task" })

  export type Info = typeof TeamTaskTable.$inferSelect

  export async function create(input: {
    teamID: string
    title: string
    description?: string
    depends_on?: string[]
  }) {
    const id = Identifier.ascending("team_task")
    const now = Date.now()
    Database.use((db) => {
      db.insert(TeamTaskTable)
        .values({
          id,
          team_id: input.teamID,
          title: input.title,
          description: input.description ?? null,
          status: "pending",
          assigned_to: null,
          depends_on: input.depends_on ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    log.info("created", { id, title: input.title })
    return id
  }

  export async function claim(taskID: string, sessionID: string) {
    return Database.use((db) => {
      const task = db
        .select()
        .from(TeamTaskTable)
        .where(eq(TeamTaskTable.id, taskID))
        .get()
      if (!task) throw new Error(`Task not found: ${taskID}`)
      if (task.status !== "pending")
        throw new Error(`Task ${taskID} is not pending (status: ${task.status})`)

      if (task.depends_on && task.depends_on.length > 0) {
        const deps = db
          .select()
          .from(TeamTaskTable)
          .where(eq(TeamTaskTable.team_id, task.team_id))
          .all()
        const incomplete = task.depends_on.filter((depID) => {
          const dep = deps.find((d) => d.id === depID)
          return !dep || dep.status !== "completed"
        })
        if (incomplete.length > 0)
          throw new Error(
            `Task ${taskID} is blocked by unresolved dependencies: ${incomplete.join(", ")}`,
          )
      }

      const result = db
        .update(TeamTaskTable)
        .set({
          status: "in_progress",
          assigned_to: sessionID,
          time_updated: Date.now(),
        })
        .where(and(eq(TeamTaskTable.id, taskID), eq(TeamTaskTable.status, "pending")))
        .returning()
        .get()

      if (!result) throw new Error(`Task ${taskID} was already claimed`)
      log.info("claimed", { id: taskID, by: sessionID })
      return result
    })
  }

  export async function complete(taskID: string, sessionID: string) {
    const result = Database.use((db) =>
      db
        .update(TeamTaskTable)
        .set({ status: "completed", time_updated: Date.now() })
        .where(
          and(
            eq(TeamTaskTable.id, taskID),
            eq(TeamTaskTable.assigned_to, sessionID),
          ),
        )
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Task ${taskID} not found or not assigned to this session`)
    log.info("completed", { id: taskID, by: sessionID })
    await Bus.publish(Team.Event.TaskCompleted, {
      teamID: result.team_id,
      taskID,
      sessionID,
    })
    return result
  }

  export function list(teamID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(TeamTaskTable)
        .where(eq(TeamTaskTable.team_id, teamID))
        .all(),
    )
  }

  export async function reassign(sessionID: string) {
    const updated = Database.use((db) =>
      db
        .update(TeamTaskTable)
        .set({
          status: "pending",
          assigned_to: null,
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(TeamTaskTable.assigned_to, sessionID),
            eq(TeamTaskTable.status, "in_progress"),
          ),
        )
        .returning()
        .all(),
    )
    if (updated.length > 0)
      log.info("reassigned", {
        count: updated.length,
        from: sessionID,
      })
    return updated
  }
}
