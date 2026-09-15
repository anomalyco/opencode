import type { PersistentPtyInfo } from "@opencode/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useConfig } from "../config"
import { useData } from "./data"
import { useEvent } from "./event"
import { useStorage } from "./storage"

type SessionTerminalsState = {
  servers?: Record<string, { sessions: Record<string, string | null> }>
  // The managed local server continues using the legacy fields.
  sessions?: Record<string, string | null>
}

export const { use: useSessionTerminals, provider: SessionTerminalsProvider } = createSimpleContext({
  name: "SessionTerminals",
  init: () => {
    const client = useClient()
    const config = useConfig().data
    const data = useData()
    const event = useEvent()
    const [focus, setFocus] = createSignal<string>()
    const storage = useStorage()
    const [store, update] = storage.store<SessionTerminalsState>("session-terminal-selection", {
      initial: { servers: {} },
    })
    const [terminals, updateTerminals] = storage.memory<Record<string, PersistentPtyInfo[]>>(
      `session-terminals:${client.server}`,
      {
        initial: {},
      },
    )
    const selected = () => (client.server === "local" ? store.sessions : store.servers?.[client.server]?.sessions)

    const refresh = async (sessionID: string) => {
      if (!terminals[sessionID]) updateTerminals((draft) => (draft[sessionID] = []))
      const result = await client.api.experimental.persistentPty.list({ sessionID })
      updateTerminals((draft) => (draft[sessionID] = result))
      const current = selected()?.[sessionID]
      if (!current || result.some((terminal) => terminal.id === current)) return
      await update((draft) => {
        const sessions = client.server === "local" ? draft.sessions : draft.servers?.[client.server]?.sessions
        if (!sessions || sessions[sessionID] !== current) return
        sessions[sessionID] = null
      })
    }

    const selectTerminal = async (sessionID: string, ptyID: string | null) => {
      if (ptyID !== null && !terminals[sessionID]?.some((terminal) => terminal.id === ptyID)) return
      setFocus(ptyID ?? undefined)
      await update((draft) => {
        if (client.server === "local") {
          draft.sessions ??= {}
          draft.sessions[sessionID] = ptyID
          return
        }
        draft.servers ??= {}
        const server = (draft.servers[client.server] ??= { sessions: {} })
        server.sessions[sessionID] = ptyID
      })
    }

    for (const type of ["persistent-pty.added", "persistent-pty.removed"] as const) {
      onCleanup(
        event.on(type, (evt) => {
          if (!config.session.terminal || !terminals[evt.data.sessionID]) return
          void refresh(evt.data.sessionID).catch((error) =>
            console.error("Failed to refresh persistent terminal panes", error),
          )
        }),
      )
    }
    onCleanup(
      event.on("server.connected", () => {
        if (!config.session.terminal) return
        Object.keys(terminals).forEach((sessionID) => {
          void refresh(sessionID).catch((error) => console.error("Failed to refresh persistent terminal panes", error))
        })
      }),
    )

    return {
      get(sessionID: string) {
        return {
          terminals: terminals[sessionID] ?? [],
          selectedTerminalID: selected()?.[sessionID] ?? null,
        }
      },
      refresh,
      selectTerminal,
      async newTerminal(sessionID: string): Promise<PersistentPtyInfo> {
        const session = data.session.get(sessionID)
        const terminal = await client.api.experimental.persistentPty.create({
          sessionID,
          args: [],
          cwd: session?.location.directory,
          title: "Terminal",
          env: {},
        })
        await refresh(sessionID)
        await selectTerminal(sessionID, terminal.id)
        return terminal
      },
      shouldFocus(ptyID: string) {
        return focus() === ptyID
      },
      clearFocus(ptyID: string) {
        setFocus((current) => (current === ptyID ? undefined : current))
      },
    }
  },
})
