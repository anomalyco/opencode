import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createContext, createEffect, createMemo, useContext, type ParentProps } from "solid-js"
import { uniqueBy } from "remeda"
import type { FileContent, FileNode, Model, Provider, File as FileStatus } from "@opencode-ai/sdk"
import { useSDK, useEvent, useSync } from "@/context"

export type LocalFile = FileNode &
  Partial<{
    loaded: boolean
    pinned: boolean
    expanded: boolean
    content: FileContent
    selection: { startLine: number; startChar: number; endLine: number; endChar: number }
    scrollTop: number
    view: "raw" | "diff-unified" | "diff-split"
    folded: string[]
    selectedChange: number
    status: FileStatus
  }>
export type TextSelection = LocalFile["selection"]
export type View = LocalFile["view"]

export type LocalModel = Omit<Model, "provider"> & {
  provider: Provider
}
export type ModelKey = { providerID: string; modelID: string }

export type FileContext = { type: "file"; path: string; selection?: TextSelection }
export type ContextItem = FileContext

function init() {
  const sdk = useSDK()
  const sync = useSync()

  const agent = (() => {
    const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent"))
    const [store, setStore] = createStore<{
      current: string
    }>({
      current: list()[0].name,
    })
    return {
      list,
      current() {
        return list().find((x) => x.name === store.current)!
      },
      set(name: string | undefined) {
        setStore("current", name ?? list()[0].name)
      },
      move(direction: 1 | -1) {
        let next = list().findIndex((x) => x.name === store.current) + direction
        if (next < 0) next = list().length - 1
        if (next >= list().length) next = 0
        const value = list()[next]
        setStore("current", value.name)
        if (value.model)
          model.set({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
      },
    }
  })()

  const model = (() => {
    const list = createMemo(() =>
      sync.data.provider.flatMap((p) => Object.values(p.models).map((m) => ({ ...m, provider: p }) as LocalModel)),
    )
    const find = (key: ModelKey) => list().find((m) => m.id === key?.modelID && m.provider.id === key.providerID)

    const [store, setStore] = createStore<{
      model: Record<string, ModelKey>
      recent: ModelKey[]
    }>({
      model: {},
      recent: [],
    })

    const value = localStorage.getItem("model")
    setStore("recent", JSON.parse(value ?? "[]"))
    createEffect(() => {
      localStorage.setItem("model", JSON.stringify(store.recent))
    })

    const fallback = createMemo(() => {
      if (store.recent.length) return store.recent[0]
      const provider = sync.data.provider[0]
      const model = Object.values(provider.models)[0]
      return { modelID: model.id, providerID: provider.id }
    })

    const current = createMemo(() => {
      const a = agent.current()
      return find(store.model[agent.current().name]) ?? find(a.model ?? fallback())
    })

    const recent = createMemo(() => store.recent.map(find).filter(Boolean))

    return {
      list,
      current,
      recent,
      set(model: ModelKey | undefined, options?: { recent?: boolean }) {
        batch(() => {
          setStore("model", agent.current().name, model ?? fallback())
          if (options?.recent && model) {
            const uniq = uniqueBy([model, ...store.recent], (x) => x.providerID + x.modelID)
            if (uniq.length > 5) uniq.pop()
            setStore("recent", uniq)
          }
        })
      },
    }
  })()

  const file = (() => {
    const [store, setStore] = createStore<{
      node: Record<string, LocalFile>
      opened: string[]
      active?: string
    }>({
      node: Object.fromEntries(sync.data.node.map((x) => [x.path, x])),
      opened: [],
    })

    const active = createMemo(() => {
      if (!store.active) return undefined
      return store.node[store.active]
    })
    const opened = createMemo(() => store.opened.map((x) => store.node[x]))
    const changeset = createMemo(() => new Set(sync.data.changes.map((f) => f.path)))
    const changes = createMemo(() => Array.from(changeset()).sort((a, b) => a.localeCompare(b)))

    createEffect((prev: FileStatus[]) => {
      const removed = prev.filter((p) => !sync.data.changes.find((c) => c.path === p.path))
      for (const p of removed) {
        setStore(
          "node",
          p.path,
          produce((draft) => {
            draft.status = undefined
            draft.view = "raw"
          }),
        )
        load(p.path)
      }
      for (const p of sync.data.changes) {
        if (store.node[p.path] === undefined) {
          fetch(p.path).then(() => setStore("node", p.path, "status", p))
        } else {
          setStore("node", p.path, "status", p)
        }
      }
      return sync.data.changes
    }, sync.data.changes)

    const changed = (path: string) => {
      const node = store.node[path]
      if (node?.status) return true
      const set = changeset()
      if (set.has(path)) return true
      for (const p of set) {
        if (p.startsWith(path ? path + "/" : "")) return true
      }
      return false
    }

    const resetNode = (path: string) => {
      setStore("node", path, {
        loaded: undefined,
        pinned: undefined,
        content: undefined,
        selection: undefined,
        scrollTop: undefined,
        folded: undefined,
        view: undefined,
        selectedChange: undefined,
      })
    }

    const relative = (path: string) => path.replace(sync.data.path.directory + "/", "")

    const load = async (path: string) => {
      const relativePath = relative(path)
      sdk.file.read({ query: { path: relativePath } }).then((x) => {
        setStore(
          "node",
          relativePath,
          produce((draft) => {
            draft.loaded = true
            draft.content = x.data
          }),
        )
      })
    }

    const fetch = async (path: string) => {
      const relativePath = relative(path)
      const parent = relativePath.split("/").slice(0, -1).join("/")
      if (parent) {
        await list(parent)
      }
    }

    const open = async (path: string, options?: { pinned?: boolean; view?: LocalFile["view"] }) => {
      const relativePath = relative(path)
      if (!store.node[relativePath]) await fetch(path)
      setStore("opened", (x) => {
        if (x.includes(relativePath)) return x
        return [
          ...opened()
            .filter((x) => x.pinned)
            .map((x) => x.path),
          relativePath,
        ]
      })
      setStore("active", relativePath)
      context.addActive()
      if (options?.pinned) setStore("node", path, "pinned", true)
      if (options?.view && store.node[relativePath].view === undefined) setStore("node", path, "view", options.view)
      if (store.node[relativePath].loaded) return
      return load(relativePath)
    }

    const list = async (path: string) => {
      return sdk.file.list({ query: { path: path + "/" } }).then((x) => {
        setStore(
          "node",
          produce((draft) => {
            x.data!.forEach((node) => {
              if (node.path in draft) return
              draft[node.path] = node
            })
          }),
        )
      })
    }

    const search = (query: string) => sdk.find.files({ query: { query } }).then((x) => x.data!)

    const bus = useEvent()
    bus.listen((event) => {
      switch (event.type) {
        case "message.part.updated":
          const part = event.properties.part
          if (part.type === "tool" && part.state.status === "completed") {
            switch (part.tool) {
              case "read":
                break
              case "edit":
                // load(part.state.input["filePath"] as string)
                break
              default:
                break
            }
          }
          break
        case "file.watcher.updated":
          setTimeout(sync.load.changes, 1000)
          const relativePath = relative(event.properties.file)
          if (relativePath.startsWith(".git/")) return
          load(relativePath)
          break
      }
    })

    return {
      active,
      opened,
      node: (path: string) => store.node[path],
      update: (path: string, node: LocalFile) => setStore("node", path, reconcile(node)),
      open,
      load,
      close(path: string) {
        setStore("opened", (opened) => opened.filter((x) => x !== path))
        if (store.active === path) {
          const index = store.opened.findIndex((f) => f === path)
          const previous = store.opened[Math.max(0, index - 1)]
          setStore("active", previous)
        }
        resetNode(path)
      },
      expand(path: string) {
        setStore("node", path, "expanded", true)
        if (store.node[path].loaded) return
        setStore("node", path, "loaded", true)
        list(path)
      },
      collapse(path: string) {
        setStore("node", path, "expanded", false)
      },
      select(path: string, selection: TextSelection | undefined) {
        setStore("node", path, "selection", selection)
      },
      scroll(path: string, scrollTop: number) {
        setStore("node", path, "scrollTop", scrollTop)
      },
      move(path: string, to: number) {
        const index = store.opened.findIndex((f) => f === path)
        if (index === -1) return
        setStore(
          "opened",
          produce((opened) => {
            opened.splice(to, 0, opened.splice(index, 1)[0])
          }),
        )
        setStore("node", path, "pinned", true)
      },
      view(path: string): View {
        const n = store.node[path]
        return n && n.view ? n.view : "raw"
      },
      setView(path: string, view: View) {
        setStore("node", path, "view", view)
      },
      unfold(path: string, key: string) {
        setStore("node", path, "folded", (xs) => {
          const a = xs ?? []
          if (a.includes(key)) return a
          return [...a, key]
        })
      },
      fold(path: string, key: string) {
        setStore("node", path, "folded", (xs) => (xs ?? []).filter((k) => k !== key))
      },
      folded(path: string) {
        const n = store.node[path]
        return n && n.folded ? n.folded : []
      },
      changeIndex(path: string) {
        return store.node[path]?.selectedChange
      },
      setChangeIndex(path: string, index: number | undefined) {
        setStore("node", path, "selectedChange", index)
      },
      changes,
      changed,
      children(path: string) {
        return Object.values(store.node).filter(
          (x) =>
            x.path.startsWith(path) &&
            x.path !== path &&
            !x.path.replace(new RegExp(`^${path + "/"}`), "").includes("/"),
        )
      },
      search,
      relative,
    }
  })()

  const layout = (() => {
    type PaneState = { size: number; visible: boolean }
    type LayoutState = { panes: Record<string, PaneState>; order: string[] }
    type PaneDefault = number | { size: number; visible?: boolean }

    const [store, setStore] = createStore<Record<string, LayoutState>>({})

    const raw = localStorage.getItem("layout")
    if (raw) {
      const data = JSON.parse(raw)
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const first = Object.values(data)[0] as LayoutState
        if (first && typeof first === "object" && "panes" in first) {
          setStore(() => data as Record<string, LayoutState>)
        }
      }
    }

    createEffect(() => {
      localStorage.setItem("layout", JSON.stringify(store))
    })

    const normalize = (value: PaneDefault): PaneState => {
      if (typeof value === "number") return { size: value, visible: true }
      return { size: value.size, visible: value.visible ?? true }
    }

    const ensure = (id: string, defaults: Record<string, PaneDefault>) => {
      const entries = Object.entries(defaults)
      if (!entries.length) return
      setStore(id, (current) => {
        if (current) return current
        return {
          panes: Object.fromEntries(entries.map(([pane, config]) => [pane, normalize(config)])),
          order: entries.map(([pane]) => pane),
        }
      })
      for (const [pane, config] of entries) {
        if (!store[id]?.panes[pane]) {
          setStore(id, "panes", pane, () => normalize(config))
        }
        if (!(store[id]?.order ?? []).includes(pane)) {
          setStore(id, "order", (list) => [...list, pane])
        }
      }
    }

    const ensurePane = (id: string, pane: string, fallback?: PaneDefault) => {
      if (!store[id]) {
        const value = normalize(fallback ?? { size: 0, visible: true })
        setStore(id, () => ({
          panes: { [pane]: value },
          order: [pane],
        }))
        return
      }
      if (!store[id].panes[pane]) {
        const value = normalize(fallback ?? { size: 0, visible: true })
        setStore(id, "panes", pane, () => value)
      }
      if (!store[id].order.includes(pane)) {
        setStore(id, "order", (list) => [...list, pane])
      }
    }

    const size = (id: string, pane: string) => store[id]?.panes[pane]?.size ?? 0
    const visible = (id: string, pane: string) => store[id]?.panes[pane]?.visible ?? false

    const setSize = (id: string, pane: string, value: number) => {
      if (!store[id]?.panes[pane]) return
      const next = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
      setStore(id, "panes", pane, "size", next)
    }

    const setVisible = (id: string, pane: string, value: boolean) => {
      if (!store[id]?.panes[pane]) return
      setStore(id, "panes", pane, "visible", value)
    }

    const toggle = (id: string, pane: string) => {
      setVisible(id, pane, !visible(id, pane))
    }

    const show = (id: string, pane: string) => setVisible(id, pane, true)
    const hide = (id: string, pane: string) => setVisible(id, pane, false)
    const order = (id: string) => store[id]?.order ?? []

    return {
      ensure,
      ensurePane,
      size,
      visible,
      setSize,
      setVisible,
      toggle,
      show,
      hide,
      order,
    }
  })()

  const session = (() => {
    const [store, setStore] = createStore<{
      active?: string
    }>({})

    const active = createMemo(() => {
      if (!store.active) return undefined
      return sync.session.get(store.active)
    })

    return {
      active,
      setActive(sessionId: string | undefined) {
        setStore("active", sessionId)
      },
      clearActive() {
        setStore("active", undefined)
      },
    }
  })()

  const context = (() => {
    const [store, setStore] = createStore<{
      activeTab: boolean
      items: (ContextItem & { key: string })[]
    }>({
      activeTab: true,
      items: [],
    })

    return {
      all() {
        return store.items
      },
      active() {
        return store.activeTab ? file.active() : undefined
      },
      addActive() {
        setStore("activeTab", true)
      },
      removeActive() {
        setStore("activeTab", false)
      },
      add(item: ContextItem) {
        let key = item.type
        switch (item.type) {
          case "file":
            key += `${item.path}:${item.selection?.startLine}:${item.selection?.endLine}`
            break
        }
        if (store.items.find((x) => x.key === key)) return
        setStore("items", (x) => [...x, { key, ...item }])
      },
      remove(key: string) {
        setStore("items", (x) => x.filter((x) => x.key !== key))
      },
    }
  })()

  const result = {
    model,
    agent,
    file,
    layout,
    session,
    context,
  }
  return result
}

type LocalContext = ReturnType<typeof init>

const ctx = createContext<LocalContext>()

export function LocalProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useLocal() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useLocal must be used within a LocalProvider")
  }
  return value
}
