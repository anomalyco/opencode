import type { GroupInfo, GroupItem, LocationRef, PersistentPtyInfo } from "@opencode-ai/client"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useData } from "./data"
import { useStorage } from "./storage"
import { reconcilePaneLayout, removePaneLayoutItem, type PaneLayoutNode } from "./pane-layout-model"
import { useEvent } from "./event"
import { onCleanup } from "solid-js"

type PaneWorkspace = {
  sessionID?: string
  groupID: string
  items: GroupItem[]
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
    const [store, update] = useStorage().store<PaneLayoutState>("pane-layout-v1", {
      initial: { workspaces: {} },
    })

    const save = (key: string, group: GroupInfo, sessionID?: string) =>
      update((draft) => {
        const layout = reconcilePaneLayout(draft.workspaces[key]?.layout, group.items)
        if (!layout) {
          delete draft.workspaces[key]
          return
        }
        draft.workspaces[key] = {
          sessionID,
          groupID: group.id,
          items: group.items,
          layout,
        }
      })

    onCleanup(
      event.on("group.item.removed", (evt) => {
        void update((draft) => {
          Object.entries(draft.workspaces).forEach(([sessionID, workspace]) => {
            if (workspace.groupID !== evt.data.groupID) return
            const layout = removePaneLayoutItem(workspace.layout, evt.data.item)
            if (!layout) {
              delete draft.workspaces[sessionID]
              return
            }
            workspace.items = workspace.items.filter(
              (item) => item.type !== evt.data.item.type || item.id !== evt.data.item.id,
            )
            workspace.layout = layout
          })
        }).catch((error) => console.error("Failed to remove pane layout item", error))
      }),
    )

    return {
      get(sessionID: string) {
        return store.workspaces[sessionID]
      },
      async load(sessionID: string) {
        const current = store.workspaces[sessionID]
        if (current) {
          const group = await client.api["server.persistentPty"].group.get({ groupID: current.groupID })
          await save(sessionID, group, sessionID)
          return
        }
        const groups = await client.api["server.persistentPty"].group.list()
        const group = groups.find((item) =>
          item.items.some((entry) => entry.type === "session" && entry.id === sessionID),
        )
        if (group) await save(sessionID, group, sessionID)
      },
      getGroup(groupID: string) {
        return store.workspaces[groupID]
      },
      async loadGroup(groupID: string) {
        await save(groupID, await client.api["server.persistentPty"].group.get({ groupID }))
      },
      async refresh(sessionID: string) {
        const current = store.workspaces[sessionID]
        if (!current) return
        const group = await client.api["server.persistentPty"].group.get({ groupID: current.groupID })
        await save(sessionID, group, sessionID)
      },
      async newTerminal(sessionID: string): Promise<PersistentPtyInfo> {
        const api = client.api["server.persistentPty"]
        const current = store.workspaces[sessionID]
        const existing = current
          ? await api.group.get({ groupID: current.groupID })
          : (await api.group.list()).find((group) =>
              group.items.some((item) => item.type === "session" && item.id === sessionID),
            )
        const group = existing ?? (await api.group.create({ items: [{ type: "session", id: sessionID }] }))
        const session = data.session.get(sessionID)
        const terminal = await api.create({
          groupID: group.id,
          command: process.env.SHELL || "/bin/sh",
          args: [],
          cwd: session?.location.directory ?? process.cwd(),
          title: "Terminal",
          env: {},
        })
        const next = await api.group.get({ groupID: group.id })
        await save(sessionID, next, sessionID)
        return terminal
      },
      async newTerminalWorkspace(location: LocationRef) {
        const api = client.api["server.persistentPty"]
        const group = await api.group.create({ items: [] })
        const terminal = await api
          .create({
            groupID: group.id,
            command: process.env.SHELL || "/bin/sh",
            args: [],
            cwd: location.directory,
            title: "Terminal",
            env: {},
          })
          .catch(async (error) => {
            await api.group.remove({ groupID: group.id }).catch(() => undefined)
            throw error
          })
        await save(group.id, await api.group.get({ groupID: group.id }))
        return { group, terminal }
      },
    }
  },
})
