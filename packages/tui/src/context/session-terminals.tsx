import type { PersistentPtyInfo } from "@opencode-ai/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useConfig } from "../config"
import { useData } from "./data"
import { useEvent } from "./event"
import { useStorage } from "./storage"

type SessionTerminals = {
  terminals: PersistentPtyInfo[]
  selectedTerminalID?: string
  hidden?: boolean
}

type SessionTerminalsState = {
  sessions: Record<string, SessionTerminals>
}

export const { use: useSessionTerminals, provider: SessionTerminalsProvider } = createSimpleContext({
  name: "SessionTerminals",
  init: () => {
    const client = useClient()
    const config = useConfig().data
    const data = useData()
    const event = useEvent()
    const [focus, setFocus] = createSignal<string>()
    const [store, update] = useStorage().store<SessionTerminalsState>("session-terminals-v1", {
      initial: { sessions: {} },
    })

    const save = (sessionID: string, terminals: PersistentPtyInfo[], selectedTerminalID?: string) =>
      update((draft) => {
        const current = draft.sessions[sessionID]?.selectedTerminalID
        const selected = selectedTerminalID ?? current
        draft.sessions[sessionID] = {
          terminals,
          selectedTerminalID: terminals.some((terminal) => terminal.id === selected) ? selected : terminals.at(-1)?.id,
          ...(selectedTerminalID === undefined && draft.sessions[sessionID]?.hidden ? { hidden: true } : {}),
        }
      })

    const refresh = async (sessionID: string) => {
      await save(sessionID, await client.api.experimental.persistentPty.list({ sessionID }))
    }

    for (const type of ["persistent-pty.added", "persistent-pty.removed"] as const) {
      onCleanup(
        event.on(type, (evt) => {
          if (!config.session.terminal || !store.sessions[evt.data.sessionID]) return
          void refresh(evt.data.sessionID).catch((error) =>
            console.error("Failed to refresh persistent terminal panes", error),
          )
        }),
      )
    }

    return {
      get(sessionID: string) {
        return store.sessions[sessionID]
      },
      refresh,
      selectTerminal(sessionID: string, ptyID: string) {
        setFocus(ptyID)
        return update((draft) => {
          const session = draft.sessions[sessionID]
          if (!session?.terminals.some((terminal) => terminal.id === ptyID)) return
          session.selectedTerminalID = ptyID
          delete session.hidden
        })
      },
      hideTerminal(sessionID: string) {
        return update((draft) => {
          const session = draft.sessions[sessionID]
          if (session) session.hidden = true
        })
      },
      async newTerminal(sessionID: string): Promise<PersistentPtyInfo> {
        const session = data.session.get(sessionID)
        const terminal = await client.api.experimental.persistentPty.create({
          sessionID,
          command: process.env.SHELL || "/bin/sh",
          args: [],
          cwd: session?.location.directory ?? process.cwd(),
          title: "Terminal",
          env: {},
        })
        setFocus(terminal.id)
        await save(sessionID, await client.api.experimental.persistentPty.list({ sessionID }), terminal.id)
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
