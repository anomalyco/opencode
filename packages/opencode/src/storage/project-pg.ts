import { getDb } from "./db.pg"
import { ProjectTablePg } from "./schema.pg"
import { eq } from "drizzle-orm"
import { ProjectID } from "../project/schema"

export async function createProjectSimple(input: { name: string; tenantUserId: string }) {
  const db = getDb()
  const id = ProjectID.makeUnsafe(crypto.randomUUID())
  const now = Date.now()

  await db.insert(ProjectTablePg).values({
    id,
    tenant_user_id: input.tenantUserId,
    name: input.name,
    time_created: now,
    time_updated: now,
  })

  const rows = await db.select().from(ProjectTablePg).where(eq(ProjectTablePg.id, id))
  const row = rows[0]

  if (!row) throw new Error("Failed to create project")

  const icon =
    row.icon_url || row.icon_color ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined } : undefined
  const project = {
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

  return { project }
}

export async function listProjectsSimple(tenantUserId?: string) {
  const db = getDb()

  const rows = tenantUserId
    ? await db.select().from(ProjectTablePg).where(eq(ProjectTablePg.tenant_user_id, tenantUserId))
    : await db.select().from(ProjectTablePg)

  return rows.map((row) => {
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
  })
}
