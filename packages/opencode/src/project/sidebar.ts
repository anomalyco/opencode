import z from "zod"
import { Database, eq } from "../storage/db"
import { ProjectSidebarTable } from "./sidebar.sql"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"

export namespace Sidebar {
  export const Item = z
    .object({
      worktree: z.string(),
      sort_order: z.number(),
    })
    .meta({ ref: "SidebarItem" })
  export type Item = z.infer<typeof Item>

  export const Event = {
    Updated: BusEvent.define("project.sidebar.updated", z.object({ items: Item.array() })),
  }

  function canonical(worktree: string) {
    return Filesystem.resolve(worktree)
  }

  function emit(items: Item[]) {
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: { items },
      },
    })
  }

  export function list(): Item[] {
    return Database.use((db) =>
      db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all(),
    )
  }

  export function open(worktree: string): Item[] {
    const resolved = canonical(worktree)
    return Database.use((db) => {
      const existing = db
        .select()
        .from(ProjectSidebarTable)
        .where(eq(ProjectSidebarTable.worktree, resolved))
        .get()
      if (existing) return list()

      const rows = db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all()
      for (const row of rows) {
        db.update(ProjectSidebarTable)
          .set({ sort_order: row.sort_order + 1 })
          .where(eq(ProjectSidebarTable.worktree, row.worktree))
          .run()
      }
      db.insert(ProjectSidebarTable).values({ worktree: resolved, sort_order: 0 }).run()

      const items = db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all()
      emit(items)
      return items
    })
  }

  export function close(worktree: string): Item[] {
    const resolved = canonical(worktree)
    return Database.use((db) => {
      const removed = db
        .delete(ProjectSidebarTable)
        .where(eq(ProjectSidebarTable.worktree, resolved))
        .returning()
        .get()
      if (!removed) return list()

      const rows = db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all()
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].sort_order !== i) {
          db.update(ProjectSidebarTable)
            .set({ sort_order: i })
            .where(eq(ProjectSidebarTable.worktree, rows[i].worktree))
            .run()
        }
      }

      const items = db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all()
      emit(items)
      return items
    })
  }

  export function reorder(worktrees: string[]): Item[] {
    const resolved = [...new Set(worktrees.map(canonical))]
    return Database.use((db) => {
      db.delete(ProjectSidebarTable).run()
      for (let i = 0; i < resolved.length; i++) {
        db.insert(ProjectSidebarTable).values({ worktree: resolved[i], sort_order: i }).run()
      }

      const items = db.select().from(ProjectSidebarTable).orderBy(ProjectSidebarTable.sort_order).all()
      emit(items)
      return items
    })
  }
}
