import z from "zod"
import path from "path"
import { Database, eq } from "../storage/db"
import { SidebarTable } from "./sidebar.sql"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"

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

  function normalize(worktree: string) {
    return path.resolve(worktree).replace(/\/+$/, "")
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
      db
        .select()
        .from(SidebarTable)
        .orderBy(SidebarTable.sort_order)
        .all()
        .map((row) => ({ worktree: row.worktree, sort_order: row.sort_order })),
    )
  }

  export function open(worktree: string): Item[] {
    const normalized = normalize(worktree)
    const existing = Database.use((db) =>
      db.select().from(SidebarTable).where(eq(SidebarTable.worktree, normalized)).get(),
    )
    if (existing) return list()

    // Insert at top (sort_order 0), shift others down
    Database.use((db) => {
      const rows = db.select().from(SidebarTable).orderBy(SidebarTable.sort_order).all()
      for (const row of rows) {
        db.update(SidebarTable)
          .set({ sort_order: row.sort_order + 1 })
          .where(eq(SidebarTable.worktree, row.worktree))
          .run()
      }
      db.insert(SidebarTable).values({ worktree: normalized, sort_order: 0 }).run()
    })

    const items = list()
    emit(items)
    return items
  }

  export function close(worktree: string): Item[] {
    const normalized = normalize(worktree)
    const removed = Database.use((db) =>
      db.delete(SidebarTable).where(eq(SidebarTable.worktree, normalized)).returning().get(),
    )
    if (!removed) return list()

    // Recompact sort_order
    Database.use((db) => {
      const rows = db.select().from(SidebarTable).orderBy(SidebarTable.sort_order).all()
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].sort_order !== i) {
          db.update(SidebarTable)
            .set({ sort_order: i })
            .where(eq(SidebarTable.worktree, rows[i].worktree))
            .run()
        }
      }
    })

    const items = list()
    emit(items)
    return items
  }

  export function reorder(worktrees: string[]): Item[] {
    const normalized = [...new Set(worktrees.map(normalize))]

    Database.use((db) => {
      // Clear existing
      db.delete(SidebarTable).run()
      // Insert in order
      for (let i = 0; i < normalized.length; i++) {
        db.insert(SidebarTable).values({ worktree: normalized[i], sort_order: i }).run()
      }
    })

    const items = list()
    emit(items)
    return items
  }
}
