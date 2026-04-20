import z from "zod"
import { fn } from "@/util/fn"
import { Database } from "@/storage/db.pg"
import { eq } from "drizzle-orm"
import { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { ProjectID } from "@/project/schema"
import { WorkspaceTable } from "@/storage/schema"
import { getAdaptor } from "./adaptors"
import { WorkspaceInfo } from "./types"
import { WorkspaceID } from "./schema"
import { parseSSE } from "./sse"

export namespace Workspace {
  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = WorkspaceInfo.meta({
    ref: "Workspace",
  })
  export type Info = z.infer<typeof Info>

  function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
    return {
      id: row.id,
      type: row.type,
      branch: row.branch,
      name: row.name,
      directory: row.directory,
      extra: row.extra,
      projectID: row.project_id,
    }
  }

  const CreateInput = z.object({
    id: WorkspaceID.zod.optional(),
    type: Info.shape.type,
    branch: Info.shape.branch,
    projectID: ProjectID.zod,
    extra: Info.shape.extra,
  })

  export const create = fn(CreateInput, async (input) => {
    const id = WorkspaceID.ascending(input.id)
    const adaptor = await getAdaptor(input.type)

    const config = await adaptor.configure({ ...input, id, name: null, directory: null })

    const info: Info = {
      id,
      type: config.type,
      branch: config.branch ?? null,
      name: config.name ?? null,
      directory: config.directory ?? null,
      extra: config.extra ?? null,
      projectID: input.projectID,
    }

    Database.use((db) => {
      db.insert(WorkspaceTable)
        .values({
          id: info.id,
          type: info.type,
          branch: info.branch,
          name: info.name,
          directory: info.directory,
          extra: info.extra,
          project_id: info.projectID,
        })
    })

    await adaptor.create(config)
    return info
  })

  export async function list(project: Project.Info) {
    const rows = await Database.use(async (db) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id)),
    )
    return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
  }

  export const get = fn(WorkspaceID.zod, async (id) => {
    const row = await Database.use(async (db) => {
      const rows = await db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id));
      return rows[0];
    });
    if (!row) return
    return fromRow(row)
  })

  export const remove = fn(WorkspaceID.zod, async (id) => {
    const row = await Database.use(async (db) => {
      const rows = await db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id));
      return rows[0];
    });
    if (row) {
      const info = fromRow(row)
      const adaptor = await getAdaptor(row.type)
      adaptor.remove(info)
      await Database.use(async (db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)))
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    while (!stop.aborted) {
      const adaptor = await getAdaptor(space.type)
      const res = await adaptor.fetch(space, "/event", { method: "GET", signal: stop }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        await Bun.sleep(1000)
        continue
      }
      await parseSSE(res.body, stop, (event) => {
        GlobalBus.emit("event", {
          directory: space.id,
          payload: event,
        })
      })
      // Wait 250ms and retry if SSE connection fails
      await Bun.sleep(250)
    }
  }

  export async function startSyncing(project: Project.Info) {
    const stop = new AbortController()
    const spaces = await list(project)

    spaces.forEach((space) => {
      void workspaceEventLoop(space, stop.signal).catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
    })

    return {
      async stop() {
        stop.abort()
      },
    }
  }
}
