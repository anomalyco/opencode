import { createEffect } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import type { DraftMcpControls } from "../mcp"

export type NewSessionExtension = { id: string; name: string; status?: string }

export type NewSessionExtensionList = ReturnType<typeof createList>

function createList(input: {
  entries: () => NewSessionExtension[]
  enabled: (entry: NewSessionExtension) => boolean
  toggle: (id: string, enabled: boolean) => void
  pending?: () => boolean
}) {
  return {
    items: () => input.entries().toSorted((a, b) => a.name.localeCompare(b.name)),
    enabled: input.enabled,
    toggle: input.toggle,
    count: () => input.entries().filter(input.enabled).length,
    pending: input.pending ?? (() => false),
  }
}

/** A server without an explicit choice starts enabled unless it is disabled. */
export function createNewSessionMcps(input: {
  servers: () => NewSessionExtension[]
  states: () => Readonly<Record<string, boolean>>
  pending: () => boolean
  change: (name: string, enabled: boolean) => void
}) {
  return createList({
    entries: input.servers,
    enabled: (server) => input.states()[server.id] ?? (server.status !== undefined && server.status !== "disabled"),
    toggle: input.change,
    pending: input.pending,
  })
}

/** Skills start enabled; the draft keeps only the ones switched off. */
export function createNewSessionSkills(input: {
  skills: () => NewSessionExtension[]
  disabled: () => readonly string[]
  setDisabled: (ids: string[]) => void
}) {
  return createList({
    entries: input.skills,
    enabled: (skill) => !input.disabled().includes(skill.id),
    toggle: (id, enabled) => {
      const others = input.disabled().filter((disabled) => disabled !== id)
      input.setDisabled(enabled ? others : [...others, id])
    },
  })
}

/** Binds the draft's MCP and skill lists to the selected directory's server data and the draft tab. */
export function createNewSessionExtensions(input: { draftID: string; mcp: DraftMcpControls }) {
  const data = useData()
  const tabs = useTabs()

  const ref = () => ({ directory: input.mcp.directory() })

  createEffect(() => {
    void Promise.all([data.location.mcp.server.sync(ref()), data.location.skill.sync(ref())]).catch(() => undefined)
  })

  return {
    mcps: createNewSessionMcps({
      servers: () =>
        (data.location.mcp.server.list(ref()) ?? []).map((server) => ({
          id: server.name,
          name: server.name,
          status: server.status.status,
        })),
      states: () => input.mcp.controls.states,
      pending: () => input.mcp.controls.pending,
      change: input.mcp.controls.change,
    }),
    skills: createNewSessionSkills({
      skills: () => (data.location.skill.list(ref()) ?? []).map((skill) => ({ id: skill.id, name: skill.name })),
      disabled: () => tabs.draft(input.draftID).disabledSkills ?? [],
      setDisabled: (disabledSkills) => tabs.updateDraft(input.draftID, { disabledSkills }),
    }),
  }
}
