import type { PersistentPtyInfo } from "@opencode-ai/client"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useData } from "./data"
import { useEvent } from "./event"
import { reconcilePaneLayout, type PaneItem, type PaneLayoutNode } from "./pane-layout-model"
import { useStorage } from "./storage"

type PaneWorkspace = {
  sessionID: string
  items: PaneItem[]
  layout: PaneLayoutNode
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
    const [store, update] = useStorage().store<PaneLayoutState>("pane-layout-v1", {
      initial: { workspaces: {} },
    })

    const save = (sessionID: string, terminals: readonly PersistentPtyInfo[]) =>
      update((draft) => {
        const items: PaneItem[] = [
          { type: "session", id: sessionID },
          ...terminals.map((terminal) => ({ type: "terminal" as const, id: terminal.id })),
        ]
        const layout = reconcilePaneLayout(draft.workspaces[sessionID]?.layout, items)
        if (!layout) return
        draft.workspaces[sessionID] = { sessionID, items, layout }
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
        await refresh(sessionID)
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
