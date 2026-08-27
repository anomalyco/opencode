import type { PersistentPtyInfo } from "@opencode-ai/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useConfig } from "../config"
import { useEvent } from "./event"
import { useStorage } from "./storage"

type SessionTerminalsState = {
  sessions: Record<string, string | null>
}

export const { use: useSessionTerminals, provider: SessionTerminalsProvider } = createSimpleContext({
  name: "SessionTerminals",
  init: () => {
    const client = useClient()
    const config = useConfig().data
    const event = useEvent()
    const [focus, setFocus] = createSignal<string>()
    const storage = useStorage()
    const [store, update] = storage.store<SessionTerminalsState>("session-terminal-selection", {
      initial: { sessions: {} },
    })
    const [terminals, updateTerminals] = storage.memory<Record<string, PersistentPtyInfo[]>>("session-terminals", {
      initial: {},
    })

    const refresh = async (sessionID: string) => {
      if (!terminals[sessionID]) updateTerminals((draft) => (draft[sessionID] = []))
      const result = await client.api.experimental.persistentPty.list({ sessionID })
      updateTerminals((draft) => (draft[sessionID] = result))
      const selected = store.sessions[sessionID]
      if (!selected || result.some((terminal) => terminal.id === selected)) return
      await update((draft) => {
        if (draft.sessions[sessionID] !== selected) return
        draft.sessions[sessionID] = null
      })
    }

    const selectTerminal = async (sessionID: string, ptyID: string | null) => {
      if (ptyID !== null && !terminals[sessionID]?.some((terminal) => terminal.id === ptyID)) return
      setFocus(ptyID ?? undefined)
      await update((draft) => {
        draft.sessions[sessionID] = ptyID
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
          selectedTerminalID: store.sessions[sessionID] ?? null,
        }
      },
      refresh,
      selectTerminal,
      async newTerminal(sessionID: string): Promise<PersistentPtyInfo> {
        const terminal = await client.api.experimental.persistentPty.create({
          sessionID,
          args: [],
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
