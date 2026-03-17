import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Instance } from "../project/instance"
import { NotFoundError } from "../storage/db"

export namespace Tab {
  export const Route = z.discriminatedUnion("type", [
    z.object({ type: z.literal("home") }),
    z.object({ type: z.literal("session"), sessionID: z.string() }),
  ])

  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string().nullable(),
      label: z.string(),
      route: Route,
      directory: z.string().optional(),
    })
    .meta({ ref: "Tab" })

  export type Info = z.infer<typeof Info>

  export const ListResponse = z
    .object({
      tabs: Info.array(),
      activeID: z.string(),
      previousID: z.string().nullable(),
      position: z.enum(["top", "bottom"]),
    })
    .meta({ ref: "TabListResponse" })

  export type ListResponse = z.infer<typeof ListResponse>

  export namespace Event {
    export const Updated = BusEvent.define("tab.updated", Info)
    export const Removed = BusEvent.define("tab.removed", z.object({ id: z.string() }))
    export const Activated = BusEvent.define(
      "tab.activated",
      z.object({ id: z.string(), previousID: z.string().nullable() }),
    )
    export const PositionChanged = BusEvent.define(
      "tab.position.changed",
      z.object({ position: z.enum(["top", "bottom"]) }),
    )
  }

  const state = Instance.state(() => ({
    tabs: [] as Info[],
    activeID: "",
    previousID: null as string | null,
    position: "bottom" as "top" | "bottom",
    counter: 0,
  }))

  function nextID() {
    const s = state()
    s.counter++
    return "tab_" + s.counter
  }

  function ensureDefault() {
    const s = state()
    if (s.tabs.length > 0) return
    const tab: Info = {
      id: nextID(),
      sessionID: null,
      label: "Untitled",
      route: { type: "home" },
    }
    s.tabs.push(tab)
    s.activeID = tab.id
  }

  export function list(): ListResponse {
    ensureDefault()
    const s = state()
    return {
      tabs: s.tabs,
      activeID: s.activeID,
      previousID: s.previousID,
      position: s.position,
    }
  }

  export async function add(opts?: { sessionID?: string; directory?: string; label?: string }): Promise<Info> {
    ensureDefault()
    const s = state()
    const tab: Info = {
      id: nextID(),
      sessionID: opts?.sessionID ?? null,
      label: opts?.label ?? "Untitled",
      route: opts?.sessionID ? { type: "session", sessionID: opts.sessionID } : { type: "home" },
      directory: opts?.directory,
    }
    s.tabs.push(tab)
    const prev = s.activeID
    s.previousID = prev
    s.activeID = tab.id
    await Bus.publish(Event.Updated, tab)
    await Bus.publish(Event.Activated, { id: tab.id, previousID: prev })
    return tab
  }

  export function get(id: string): Info {
    ensureDefault()
    const s = state()
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) throw new NotFoundError({ message: `Tab ${id} not found` })
    return tab
  }

  export async function remove(id: string) {
    ensureDefault()
    const s = state()
    if (s.tabs.length <= 1) return
    const idx = s.tabs.findIndex((t) => t.id === id)
    if (idx === -1) throw new NotFoundError({ message: `Tab ${id} not found` })
    const wasActive = s.activeID === id
    s.tabs.splice(idx, 1)
    if (s.previousID === id) s.previousID = null
    if (wasActive) {
      const nextIdx = Math.min(idx, s.tabs.length - 1)
      const next = s.tabs[nextIdx]
      s.activeID = next.id
      await Bus.publish(Event.Activated, { id: next.id, previousID: null })
    }
    await Bus.publish(Event.Removed, { id })
  }

  export async function activate(id: string) {
    ensureDefault()
    const s = state()
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) throw new NotFoundError({ message: `Tab ${id} not found` })
    if (s.activeID === id) return
    const prev = s.activeID
    s.previousID = prev
    s.activeID = id
    await Bus.publish(Event.Activated, { id, previousID: prev })
  }

  export async function last() {
    ensureDefault()
    const s = state()
    if (!s.previousID) return
    const tab = s.tabs.find((t) => t.id === s.previousID)
    if (!tab) return
    const current = s.activeID
    s.previousID = current
    s.activeID = tab.id
    await Bus.publish(Event.Activated, { id: tab.id, previousID: current })
  }

  export async function rename(id: string, label: string) {
    ensureDefault()
    const s = state()
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) throw new NotFoundError({ message: `Tab ${id} not found` })
    tab.label = label
    await Bus.publish(Event.Updated, tab)
  }

  export async function update(id: string, fields: { label?: string; sessionID?: string; directory?: string }) {
    ensureDefault()
    const s = state()
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) throw new NotFoundError({ message: `Tab ${id} not found` })
    if (fields.label !== undefined) tab.label = fields.label
    if (fields.sessionID !== undefined) {
      tab.sessionID = fields.sessionID
      tab.route = { type: "session", sessionID: fields.sessionID }
    }
    if (fields.directory !== undefined) tab.directory = fields.directory
    await Bus.publish(Event.Updated, tab)
    return tab
  }

  export async function setPosition(p: "top" | "bottom") {
    ensureDefault()
    const s = state()
    s.position = p
    await Bus.publish(Event.PositionChanged, { position: p })
  }
}
