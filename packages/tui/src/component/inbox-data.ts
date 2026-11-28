import type { SessionInfo } from "@opencode/client"
import { displayLabel } from "@opencode/util/session-title-fallback"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLog } from "../context/log"
import { useRoute } from "../context/route"

export type InboxRow = {
  id: string
  title: string
  directory: string
  detail: "Review permission" | "Answer question" | "Working" | "Failed" | ""
}
export type InboxSection = { title: string; rows: InboxRow[] }
type Group = "Needs attention" | "Working" | "Unread" | "Recent"
type Request = { id: string; sessionID: string; kind: "Approval" | "Question" }

function start(session: SessionInfo) {
  const { busy, idle } = session.time
  return busy !== undefined && (idle === undefined || idle <= busy) ? busy : undefined
}

export function useInbox() {
  const client = useClient()
  const sessions = useData().session
  const route = useRoute()
  const log = useLog({ component: "inbox" })
  const [indexed, setIndexed] = createSignal(false)
  const [snapshot, setSnapshot] = createSignal<Request[]>([])
  const cold = createMemo(() => Map.groupBy(snapshot(), (request) => request.sessionID))
  const [asked, setAsked] = createStore<Record<string, number | undefined>>({})
  onCleanup(client.event.on("permission.asked", (event) => setAsked(event.data.id, event.created)))
  onCleanup(client.event.on("permission.replied", (event) => setAsked(event.data.requestID, undefined)))
  onCleanup(client.event.on("form.created", (event) => setAsked(event.data.form.id, event.created)))
  onCleanup(client.event.on("form.replied", (event) => setAsked(event.data.id, undefined)))
  onCleanup(client.event.on("form.cancelled", (event) => setAsked(event.data.id, undefined)))
  onCleanup(
    client.event.on("session.unarchived", (event) => {
      if (!sessions.get(event.data.sessionID)) void sessions.sync(event.data.sessionID).catch(() => undefined)
    }),
  )

  createEffect(() => {
    if (client.connection.status() !== "connected") return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    // Seed lightweight metadata only; the shared store already projects subsequent events for these rows.
    // A live event delivered during the index read takes precedence over the older snapshot.
    const changed = new Set<string>()
    const unsubscribe = client.event.listen(({ details }) => {
      if ("sessionID" in details.data && typeof details.data.sessionID === "string") changed.add(details.data.sessionID)
    })
    onCleanup(unsubscribe)
    void client.api.session
      .list({ parentID: null, archived: false, order: "desc", limit: 50 }, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        batch(() => {
          for (const info of page.data) {
            if (info.parentID || info.time.archived !== undefined || sessions.missing(info.id)) continue
            if (!changed.has(info.id)) sessions.remember(info)
            else if (!sessions.get(info.id)) void sessions.sync(info.id).catch(() => undefined)
          }
        })
      })
      .catch((error) => {
        if (!controller.signal.aborted) log.warn("Could not load inbox sessions", { error })
      })
      .finally(() => {
        unsubscribe()
        if (!controller.signal.aborted) setIndexed(true)
      })

    // Requests can outlive a run. Read them once per indexed location, including for idle sessions.
    // Replies racing a snapshot win even when its owning session was never loaded in this client.
    setSnapshot([])
    const resolved = new Set<string>()
    let pending = 0
    const resolve = (id: string) => {
      if (pending) resolved.add(id)
      setSnapshot((items) => items.filter((item) => item.id !== id))
    }
    onCleanup(client.event.on("permission.replied", (event) => resolve(event.data.requestID)))
    onCleanup(client.event.on("form.replied", (event) => resolve(event.data.id)))
    onCleanup(client.event.on("form.cancelled", (event) => resolve(event.data.id)))
    const checked = new Set<string>()
    const read = (kind: Request["kind"], result: Promise<{ data: { id: string; sessionID: string }[] }>) => {
      pending++
      void result
        .then(({ data }) => {
          if (controller.signal.aborted) return
          setSnapshot((items) => [
            ...items,
            ...data
              .filter((item) => item.sessionID !== "global" && !resolved.has(item.id))
              .map(({ id, sessionID }) => ({ id, sessionID, kind })),
          ])
        })
        .catch((error) => {
          if (!controller.signal.aborted) log.warn("Could not load inbox requests", { kind, error })
        })
        .finally(() => {
          if (--pending === 0) resolved.clear()
        })
    }
    createEffect(() => {
      for (const session of sessions.list()) {
        if (session.time.archived !== undefined) continue
        const directory = session.location.directory
        if (checked.has(directory)) continue
        checked.add(directory)
        const query = { location: { directory } }
        const options = { signal: controller.signal }
        read("Approval", client.api.permission.request.list(query, options))
        read("Question", client.api.form.list(query, options))
      }
    })

    createEffect(() => {
      const targets = new Set([
        ...sessions.active(),
        ...sessions.permission.sessions(),
        ...sessions.form.sessions(),
        ...cold().keys(),
      ])
      for (const id of targets) {
        const root = sessions.root(id)
        if (!sessions.get(root) && !sessions.missing(root)) void sessions.sync(root).catch(() => undefined)
      }
    })
  })

  const sections = createMemo((): InboxSection[] => {
    const rows: Record<Group, { row: InboxRow; since: number }[]> = {
      "Needs attention": [],
      Working: [],
      Unread: [],
      Recent: [],
    }
    for (const info of sessions.list()) {
      if (info.parentID || info.time.archived !== undefined) continue
      const family = sessions.family(info.id)
      const waiting = family.flatMap((id) => cold().get(id) ?? [])
      const approval =
        family.flatMap((id) => sessions.permission.list(id) ?? [])[0] ??
        waiting.find((item) => item.kind === "Approval")
      const question =
        family.flatMap((id) => sessions.form.list(id) ?? [])[0] ?? waiting.find((item) => item.kind === "Question")
      const busy = family.some(
        (id) =>
          sessions.status(id) === "running" || sessions.pending.list(id).some((item) => item.type !== "synthetic"),
      )
      const unread =
        info.time.idle !== undefined && (info.time.viewed === undefined || info.time.idle > info.time.viewed)
      const request = approval ?? question
      const group = request ? "Needs attention" : busy ? "Working" : unread ? "Unread" : "Recent"
      const since = request
        ? (asked[request.id] ?? start(info) ?? info.time.updated)
        : busy
          ? (start(info) ?? Infinity)
          : (info.time.idle ?? info.time.updated)
      rows[group].push({
        row: {
          id: info.id,
          title: displayLabel(info),
          directory: info.location.directory,
          detail: approval
            ? "Review permission"
            : question
              ? "Answer question"
              : busy
                ? "Working"
                : unread && info.outcome === "failed"
                  ? "Failed"
                  : "",
        },
        since,
      })
    }
    for (const [key, group] of Object.entries(rows)) {
      const ascending = key === "Needs attention" || key === "Working"
      group.sort((a, b) => (ascending ? a.since - b.since : b.since - a.since) || a.row.id.localeCompare(b.row.id))
    }
    const older = rows.Recent.splice(10)
    const current = route.data.type === "session" ? sessions.root(route.data.sessionID) : undefined
    rows.Recent.push(...older.filter((item) => item.row.id === current))
    return Object.entries(rows).map(([title, items]) => ({ title, rows: items.map((item) => item.row) }))
  })

  return { sections, loading: () => !indexed() && !sections().some((section) => section.rows.length > 0) }
}
