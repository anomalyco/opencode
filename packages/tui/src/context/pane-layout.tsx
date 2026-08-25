import type { PersistentPtyInfo } from "@opencode-ai/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useData } from "./data"
import { useEvent } from "./event"
import { useStorage } from "./storage"

type PaneWorkspace = {
  sessionID: string
  terminals: PersistentPtyInfo[]
  selectedTerminalID?: string
}

type PaneLayoutState = {
  workspaces: Record<string, PaneWorkspace>
}

export const { use: usePaneLayout, provider: PaneLayoutProvider } = createSimpleContext({
  name: "PaneLayout",
  init: () => {
    const client = useClient()
    const data = useData()
    const event = useEvent()
    const [focus, setFocus] = createSignal<string>()
    const [store, update] = useStorage().store<PaneLayoutState>("pane-workspace-v1", {
      initial: { workspaces: {} },
    })

    const save = (sessionID: string, terminals: PersistentPtyInfo[], selectedTerminalID?: string) =>
      update((draft) => {
        const current = draft.workspaces[sessionID]?.selectedTerminalID
        const selected = selectedTerminalID ?? current
        draft.workspaces[sessionID] = {
          sessionID,
          terminals,
          selectedTerminalID: terminals.some((terminal) => terminal.id === selected) ? selected : terminals.at(-1)?.id,
        }
      })

    const refresh = async (sessionID: string) => {
      await save(sessionID, await client.api["server.persistentPty"].list({ sessionID }))
    }

    onCleanup(
      event.on("persistent-pty.added", (evt) => {
        if (!store.workspaces[evt.data.sessionID]) return
        void refresh(evt.data.sessionID).catch((error) =>
          console.error("Failed to add persistent terminal pane", error),
        )
      }),
    )

    onCleanup(
      event.on("persistent-pty.removed", (evt) => {
        if (!store.workspaces[evt.data.sessionID]) return
        void refresh(evt.data.sessionID).catch((error) =>
          console.error("Failed to remove persistent terminal pane", error),
        )
      }),
    )

    return {
      get(sessionID: string) {
        return store.workspaces[sessionID]
      },
      load: refresh,
      refresh,
      selectTerminal(sessionID: string, ptyID: string) {
        setFocus(ptyID)
        return update((draft) => {
          const workspace = draft.workspaces[sessionID]
          if (!workspace?.terminals.some((terminal) => terminal.id === ptyID)) return
          workspace.selectedTerminalID = ptyID
        })
      },
      async newTerminal(sessionID: string, options?: { focus?: boolean }): Promise<PersistentPtyInfo> {
        const session = data.session.get(sessionID)
        const terminal = await client.api["server.persistentPty"].create({
          sessionID,
          command: process.env.SHELL || "/bin/sh",
          args: [],
          cwd: session?.location.directory ?? process.cwd(),
          title: "Terminal",
          env: {},
        })
        if (options?.focus !== false) setFocus(terminal.id)
        await save(sessionID, await client.api["server.persistentPty"].list({ sessionID }), terminal.id)
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
