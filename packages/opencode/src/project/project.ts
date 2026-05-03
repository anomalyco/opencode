import z from "zod"
import { Database } from "../storage/db.pg"
import { eq } from "drizzle-orm"
import { ProjectTable } from "@/storage/schema"
import { Log } from "../util/log"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { ProjectID } from "./schema"

export namespace Project {
  const log = Log.create({ service: "project" })

  export const Info = z
    .object({
      id: ProjectID.zod,
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new session"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      vcs: z.literal("git").optional(),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: ProjectID.make(row.id),
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      commands: row.commands ?? undefined,
    }
  }

  export async function setInitialized(id: ProjectID) {
    await Database.use(async (db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id)),
    )
  }

  export async function list() {
    const rows = await Database.use(async (db) => db.select().from(ProjectTable))
    return rows.map((row) => fromRow(row))
  }

  export async function createSimple(input: { name: string; tenantUserId: string }) {
    const id = ProjectID.makeUnsafe(crypto.randomUUID())
    const now = Date.now()
    const insert = {
      id,
      tenant_user_id: input.tenantUserId,
      name: input.name,
      icon_url: null,
      icon_color: null,
      time_created: now,
      time_updated: now,
      time_initialized: null,
      commands: null,
    }
    await Database.use(async (db) => db.insert(ProjectTable).values(insert))
    const project = await get(id)
    if (!project) throw new Error("Failed to create project")
    return { project, directory: `/projects/${project.id}` }
  }

  /** Host-backed project: primary key is the resolved workspace path (see `Instance.workspace`). */
  export async function createForDirectory(input: { workspace: string; name: string; tenantUserId: string }) {
    const id = ProjectID.makeUnsafe(Filesystem.resolve(input.workspace))
    const now = Date.now()
    const insert = {
      id,
      tenant_user_id: input.tenantUserId,
      name: input.name,
      icon_url: null,
      icon_color: null,
      time_created: now,
      time_updated: now,
      time_initialized: null,
      commands: null,
    }
    await Database.use(async (db) => db.insert(ProjectTable).values(insert))
    const project = await get(id)
    if (!project) throw new Error("Failed to create project")
    return { project }
  }
  export async function get(id: ProjectID): Promise<Info | undefined> {
    const row = await Database.use(async (db) => {
      const rows = await db.select().from(ProjectTable).where(eq(ProjectTable.id, id))
      return rows[0]
    })
    if (!row) return undefined
    return fromRow(row)
  }

  export const update = fn(
    z.object({
      projectID: ProjectID.zod,
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const id = ProjectID.make(input.projectID)
      const result = await Database.use(async (db) => {
        const rows = await db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, id))
          .returning()
        return rows[0]
      })
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      GlobalBus.emit("event", {
        projectID: data.id,
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )
}
