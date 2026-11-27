import { createEffect } from "solid-js"
import { useData } from "@/runtime/server/current"
import type { DraftMcpControls } from "../../mcp"
import { createNewSessionExtensionList } from "../list"

export type NewSessionMcps = ReturnType<typeof createNewSessionMcps>

/** A server without an explicit choice starts enabled unless it is disabled. */
export function createNewSessionMcps(input: {
  servers: () => { id: string; name: string; status?: string }[]
  states: () => Readonly<Record<string, boolean>>
  pending: (id: string) => boolean
  change: (name: string, enabled: boolean) => void
}) {
  return createNewSessionExtensionList({
    entries: input.servers,
    enabled: (server) => input.states()[server.id] ?? (server.status !== undefined && server.status !== "disabled"),
    toggle: input.change,
    pending: input.pending,
  })
}

/** Binds the list to the selected directory's MCP servers and the draft's per-server choices. */
export function createDraftNewSessionMcps(input: { mcp: DraftMcpControls }) {
  const data = useData()
  const ref = () => ({ directory: input.mcp.directory() })

  createEffect(() => {
    void data.location.mcp.server.sync(ref()).catch(() => undefined)
  })

  return createNewSessionMcps({
    servers: () =>
      (data.location.mcp.server.list(ref()) ?? []).map((server) => ({
        id: server.name,
        name: server.name,
        status: server.status.status,
      })),
    states: () => input.mcp.controls.states,
    pending: input.mcp.controls.pending,
    change: input.mcp.controls.change,
  })
}
