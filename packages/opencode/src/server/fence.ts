import type { MiddlewareHandler } from "hono"
import { Database, inArray } from "@/storage/db"
import { EventSequenceTable } from "@/sync/event.sql"
import { Workspace } from "@/control-plane/workspace"
import type { WorkspaceID } from "@/control-plane/schema"
import { Log } from "@/util/log"

const HEADER = "x-opencode-sync"
type State = Record<string, number>
const log = Log.create({ service: "fence" })

export function load(ids?: string[]) {
  const rows = Database.use((db) => {
    if (!ids?.length) {
      return db.select().from(EventSequenceTable).all()
    }

    return db.select().from(EventSequenceTable).where(inArray(EventSequenceTable.aggregate_id, ids)).all()
  })

  return Object.fromEntries(rows.map((row) => [row.aggregate_id, row.seq])) as State
}

export function diff(prev: State, next: State) {
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)])
  return Object.fromEntries(
    [...ids]
      .map((id) => [id, next[id] ?? -1] as const)
      .filter(([id, seq]) => {
        return (prev[id] ?? -1) !== seq
      }),
  ) as State
}

export function parse(headers: Headers) {
  const raw = headers.get(HEADER)
  if (!raw) return

  let data

  try {
    data = JSON.parse(raw)
  } catch (err) {
    return
  }

  if (!data || typeof data !== "object") return

  return Object.fromEntries(
    Object.entries(data).filter(([id, seq]) => {
      return typeof id === "string" && Number.isInteger(seq)
    }),
  ) as State
}

export async function wait(workspaceID: WorkspaceID, state: State, signal?: AbortSignal) {
  log.info("waiting for state", {
    workspaceID,
    state,
  })
  await Workspace.waitForSync(workspaceID, state, signal)
  log.info("state fully synced", {
    workspaceID,
    state,
  })
}

export const FenceMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next()

  const prev = load()
  await next()
  const current = diff(prev, load())

  if (Object.keys(current).length > 0) {
    log.info("header", {
      diff: current,
    })
    c.res.headers.set(HEADER, JSON.stringify(current))
  }
}
