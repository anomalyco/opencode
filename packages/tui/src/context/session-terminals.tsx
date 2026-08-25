import type { PersistentPtyInfo } from "@opencode-ai/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useData } from "./data"
import { useEvent } from "./event"
import { useStorage } from "./storage"

type SessionTerminals = {
  sessionID: string
  terminals: PersistentPtyInfo[]
  selectedTerminalID?: string
}

type SessionTerminalsState = {
  sessions: Record<string, SessionTerminals>
}

export const { use: useSessionTerminals, provider: SessionTerminalsProvider } = createSimpleContext({
  name: "SessionTerminals",
  init: () => {
    const client = useClient()
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
          sessionID,
          terminals,
          selectedTerminalID: terminals.some((terminal) => terminal.id === selected) ? selected : terminals.at(-1)?.id,
        }
      })

    const refresh = async (sessionID: string) => {
      await save(sessionID, await client.api.experimental.persistentPty.list({ sessionID }))
    }

    onCleanup(
      event.on("persistent-pty.added", (evt) => {
        if (!store.sessions[evt.data.sessionID]) return
        void refresh(evt.data.sessionID).catch((error) =>
          console.error("Failed to add persistent terminal pane", error),
        )
      }),
    )

    onCleanup(
      event.on("persistent-pty.removed", (evt) => {
        if (!store.sessions[evt.data.sessionID]) return
        void refresh(evt.data.sessionID).catch((error) =>
          console.error("Failed to remove persistent terminal pane", error),
        )
      }),
    )

    return {
      get(sessionID: string) {
        return store.sessions[sessionID]
      },
      load: refresh,
      refresh,
      selectTerminal(sessionID: string, ptyID: string) {
        setFocus(ptyID)
        return update((draft) => {
          const session = draft.sessions[sessionID]
          if (!session?.terminals.some((terminal) => terminal.id === ptyID)) return
          session.selectedTerminalID = ptyID
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
