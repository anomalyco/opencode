import z from "zod"
import { Identifier } from "@/id/id"
import { fn } from "@/util/fn"
import { Database, eq } from "@/storage/db"
import { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { WorkspaceTable } from "./workspace.sql"
import { Config, getAdaptor } from "./adaptors"
import { WorktreeArgs } from "./adaptors/worktree"
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

  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      branch: z.string().nullable(),
      projectID: z.string(),
      config: Config,
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.infer<typeof Info>

  function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
    return {
      id: row.id,
      branch: row.branch,
      projectID: row.project_id,
      config: row.config,
    }
  }

  const CreateInput = z.object({
    id: Identifier.schema("workspace").optional(),
    projectID: Info.shape.projectID,
    branch: Info.shape.branch,
    args: z.discriminatedUnion("type", [WorktreeArgs]),
  })

  export const create = fn(CreateInput, async (input) => {
    const id = Identifier.ascending("workspace", input.id)
    const adaptor = getAdaptor(input.args.type)

    const config = await adaptor.getConfig({ workspaceID: id, branch: input.branch, args: input.args })

    const info: Info = {
      id,
      projectID: input.projectID,
      branch: input.branch,
      config,
    }

    Database.use((db) => {
      db.insert(WorkspaceTable)
        .values({
          id: info.id,
          branch: info.branch,
          project_id: info.projectID,
          config: info.config,
        })
        .run()
    })

    await adaptor.create({
      workspaceID: id,
      branch: input.branch,
      config,
    })
    return info
  })

  export function list(project: Project.Info) {
    const rows = Database.use((db) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id)).all(),
    )
    return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    const row = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
    if (!row) return
    return fromRow(row)
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const row = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
    if (row) {
      const info = fromRow(row)
      await getAdaptor(row.config.type).remove(info.config)
      Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    while (!stop.aborted) {
      const res = await getAdaptor(space.config.type)
        .fetch(space.config, "/event", { method: "GET", signal: stop })
        .catch(() => undefined)
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

  export function startSyncing(project: Project.Info) {
    const stop = new AbortController()
    const spaces = list().filter((space) => space.projectID === project.id && space.config.type !== "worktree")

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
