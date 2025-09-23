import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createContext, createEffect, createMemo, useContext, type ParentProps } from "solid-js"
import { uniqueBy } from "remeda"
import type { FileContent, FileNode, Model, Provider } from "@opencode-ai/sdk"
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
  }>
export type TextSelection = LocalFile["selection"]
export type View = LocalFile["view"]

export type LocalModel = Omit<Model, "provider"> & {
  provider: Provider
}
export type ModelKey = { providerID: string; modelID: string }

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
    const changes = createMemo(() => new Set(sync.data.changes.map((f) => f.path)))
    const status = (path: string) => sync.data.changes.find((f) => f.path === path)

    const changed = (path: string) => {
      const set = changes()
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

    const load = async (path: string) => {
      const relative = path.replace(sync.data.path.directory + "/", "")
      sdk.file.read({ query: { path: relative } }).then((x) => {
        setStore(
          "node",
          relative,
          produce((draft) => {
            draft.loaded = true
            draft.content = x.data
          }),
        )
      })
    }

    const open = async (path: string) => {
      const relative = path.replace(sync.data.path.directory + "/", "")
      if (!store.node[relative]) {
        const parent = relative.split("/").slice(0, -1).join("/")
        if (parent) {
          await list(parent)
        }
      }
      setStore("opened", (x) => {
        if (x.includes(relative)) return x
        return [
          ...opened()
            .filter((x) => x.pinned)
            .map((x) => x.path),
          relative,
        ]
      })
      setStore("active", relative)
      if (store.node[relative].loaded) return
      return load(relative)
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

    const bus = useEvent()
    bus.listen((event) => {
      switch (event.type) {
        case "message.part.updated":
          const part = event.properties.part
          if (part.type === "tool" && part.state.status === "completed") {
            switch (part.tool) {
              case "read":
                console.log("read", part.state.input)
                break
              case "edit":
                load(part.state.input["filePath"] as string)
                break
              default:
                break
            }
          }
          break
        case "file.watcher.updated":
          load(event.properties.file)
          sync.load.changes()
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
      changed,
      status,
      children(path: string) {
        return Object.values(store.node).filter(
          (x) =>
            x.path.startsWith(path) &&
            x.path !== path &&
            !x.path.replace(new RegExp(`^${path + "/"}`), "").includes("/"),
        )
      },
    }
  })()

  const layout = (() => {
    const [store, setStore] = createStore<{
      rightPane: boolean
      leftWidth: number
      rightWidth: number
    }>({
      rightPane: false,
      leftWidth: 200, // Default 50 * 4px (w-50 = 12.5rem = 200px)
      rightWidth: 320, // Default 80 * 4px (w-80 = 20rem = 320px)
    })

    const value = localStorage.getItem("layout")
    if (value) {
      const v = JSON.parse(value)
      if (typeof v?.rightPane === "boolean") setStore("rightPane", v.rightPane)
      if (typeof v?.leftWidth === "number") setStore("leftWidth", Math.max(150, Math.min(400, v.leftWidth)))
      if (typeof v?.rightWidth === "number") setStore("rightWidth", Math.max(200, Math.min(500, v.rightWidth)))
    }
    createEffect(() => {
      localStorage.setItem("layout", JSON.stringify(store))
    })

    return {
      rightPane() {
        return store.rightPane
      },
      leftWidth() {
        return store.leftWidth
      },
      rightWidth() {
        return store.rightWidth
      },
      toggleRightPane() {
        setStore("rightPane", (x) => !x)
      },
      openRightPane() {
        setStore("rightPane", true)
      },
      closeRightPane() {
        setStore("rightPane", false)
      },
      setLeftWidth(width: number) {
        setStore("leftWidth", Math.max(150, Math.min(400, width)))
      },
      setRightWidth(width: number) {
        setStore("rightWidth", Math.max(200, Math.min(500, width)))
      },
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

  const result = {
    model,
    agent,
    file,
    layout,
    session,
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
