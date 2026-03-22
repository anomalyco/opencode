import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq, and } from "../storage/db"
import { AgentMemoryTable } from "../team/team.sql"
import { MemoryID } from "../team/schema"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "agent.memory" })

const MAX_SIZE = 102_400 // 100KB

export namespace AgentMemory {
  export const Info = z
    .object({
      id: MemoryID.zod,
      projectID: z.string(),
      agent: z.string(),
      content: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "AgentMemory" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "agent.memory.updated",
      z.object({
        agent: z.string(),
        projectID: z.string(),
      }),
    ),
  }

  function toInfo(row: typeof AgentMemoryTable.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.project_id,
      agent: row.agent,
      content: row.content,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  export function read(agent: string): Info | undefined {
    const pid = Instance.project.id
    const row = Database.use((db) =>
      db
        .select()
        .from(AgentMemoryTable)
        .where(and(eq(AgentMemoryTable.project_id, pid), eq(AgentMemoryTable.agent, agent)))
        .get(),
    )
    if (!row) return undefined
    return toInfo(row)
  }

  export function write(agent: string, content: string) {
    if (Buffer.byteLength(content, "utf8") > MAX_SIZE) {
      content = content.slice(0, MAX_SIZE)
      log.warn("memory truncated to 100KB", { agent })
    }
    const pid = Instance.project.id
    const now = Date.now()
    const existing = read(agent)
    if (existing) {
      Database.use((db) =>
        db
          .update(AgentMemoryTable)
          .set({ content, time_updated: now })
          .where(eq(AgentMemoryTable.id, existing.id))
          .run(),
      )
    } else {
      const id = MemoryID.ascending()
      Database.use((db) =>
        db
          .insert(AgentMemoryTable)
          .values({
            id,
            project_id: pid,
            agent,
            content,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    }
    log.info("written", { agent, projectID: pid })
    Database.effect(() => Bus.publish(Event.Updated, { agent, projectID: pid }))
  }

  export function append(agent: string, content: string) {
    const existing = read(agent)
    if (existing) {
      write(agent, existing.content + "\n\n" + content)
    } else {
      write(agent, content)
    }
  }
}
