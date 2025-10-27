import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { pipe, sumBy, uniqueBy } from "remeda"
import type {
  FileContent,
  FileNode,
  Model,
  Provider,
  File as FileStatus,
  Part,
  Message,
  AssistantMessage,
} from "@opencode-ai/sdk"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

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

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
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

      // createEffect((prev: FileStatus[]) => {
      //   const removed = prev.filter((p) => !sync.data.changes.find((c) => c.path === p.path))
      //   for (const p of removed) {
      //     setStore(
      //       "node",
      //       p.path,
      //       produce((draft) => {
      //         draft.status = undefined
      //         draft.view = "raw"
      //       }),
      //     )
      //     load(p.path)
      //   }
      //   for (const p of sync.data.changes) {
      //     if (store.node[p.path] === undefined) {
      //       fetch(p.path).then(() => {
      //         if (store.node[p.path] === undefined) return
      //         setStore("node", p.path, "status", p)
      //       })
      //     } else {
      //       setStore("node", p.path, "status", p)
      //     }
      //   }
      //   return sync.data.changes
      // }, sync.data.changes)

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
        sdk.client.file.read({ query: { path: relativePath } }).then((x) => {
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

      const init = async (path: string) => {
        const relativePath = relative(path)
        if (!store.node[relativePath]) await fetch(path)
        if (store.node[relativePath].loaded) return
        return load(relativePath)
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
        return sdk.client.file.list({ query: { path: path + "/" } }).then((x) => {
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

      const search = (query: string) => sdk.client.find.files({ query: { query } }).then((x) => x.data!)

      sdk.event.listen((e) => {
        const event = e.details
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
        init,
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

    const session = (() => {
      const [store, setStore] = createStore<{
        active?: string
        activeMessage?: string
      }>({})

      const active = createMemo(() => {
        if (!store.active) return undefined
        return sync.session.get(store.active)
      })

      createEffect(() => {
        if (!store.active) return
        sync.session.sync(store.active)
      })

      const valid = (part: Part) => {
        if (!part) return false
        switch (part.type) {
          case "step-start":
          case "step-finish":
          case "file":
          case "patch":
            return false
          case "text":
            return !part.synthetic && part.text.trim()
          case "reasoning":
            return part.text.trim()
          case "tool":
            switch (part.tool) {
              case "todoread":
              case "todowrite":
              case "list":
              case "grep":
                return false
            }
            return true
          default:
            return true
        }
      }

      const hasValidParts = (message: Message) => {
        return sync.data.part[message.id]?.filter(valid).length > 0
      }
      // const hasTextPart = (message: Message) => {
      //   return !!sync.data.part[message.id]?.filter(valid).find((p) => p.type === "text")
      // }

      const messages = createMemo(() => (store.active ? (sync.data.message[store.active] ?? []) : []))
      const messagesWithValidParts = createMemo(() => messages().filter(hasValidParts) ?? [])
      const userMessages = createMemo(() =>
        messages()
          .filter((m) => m.role === "user")
          .sort((a, b) => b.id.localeCompare(a.id)),
      )

      const working = createMemo(() => {
        const last = messages()[messages().length - 1]
        if (!last) return false
        if (last.role === "user") return true
        return !last.time.completed
      })

      const cost = createMemo(() => {
        const total = pipe(
          messages(),
          sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
        )
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(total)
      })

      const last = createMemo(() => {
        return messages().findLast((x) => x.role === "assistant") as AssistantMessage
      })

      const lastUserMessage = createMemo(() => {
        return userMessages()?.at(0)
      })

      const activeMessage = createMemo(() => {
        if (!store.active || !store.activeMessage) return lastUserMessage()
        return sync.data.message[store.active]?.find((m) => m.id === store.activeMessage)
      })

      const activeAssistantMessages = createMemo(() => {
        if (!store.active || !activeMessage()) return []
        return sync.data.message[store.active]?.filter(
          (m) => m.role === "assistant" && m.parentID == activeMessage()?.id,
        )
      })

      const model = createMemo(() => {
        if (!last()) return
        const model = sync.data.provider.find((x) => x.id === last().providerID)?.models[last().modelID]
        return model
      })

      const tokens = createMemo(() => {
        if (!last()) return
        const tokens = last().tokens
        const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
        return new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(total)
      })

      const context = createMemo(() => {
        if (!last()) return
        if (!model()?.limit.context) return 0
        const tokens = last().tokens
        const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
        return Math.round((total / model()!.limit.context) * 100)
      })

      const getMessageText = (message: Message | Message[] | undefined): string => {
        if (!message) return ""
        if (Array.isArray(message)) return message.map((m) => getMessageText(m)).join(" ")
        return sync.data.part[message.id]
          ?.filter((p) => p.type === "text")
          ?.filter((p) => !p.synthetic)
          .map((p) => p.text)
          .join(" ")
      }

      return {
        active,
        activeMessage,
        activeAssistantMessages,
        lastUserMessage,
        cost,
        last,
        model,
        tokens,
        context,
        messages,
        messagesWithValidParts,
        userMessages,
        working,
        getMessageText,
        setActive(sessionId: string | undefined) {
          setStore("active", sessionId)
          setStore("activeMessage", undefined)
        },
        clearActive() {
          setStore("active", undefined)
          setStore("activeMessage", undefined)
        },
        setActiveMessage(messageId: string | undefined) {
          setStore("activeMessage", messageId)
        },
        clearActiveMessage() {
          setStore("activeMessage", undefined)
        },
      }
    })()

    const context = (() => {
      const [store, setStore] = createStore<{
        activeTab: boolean
        files: string[]
        activeFile?: string
        items: (ContextItem & { key: string })[]
      }>({
        activeTab: true,
        files: [],
        items: [],
      })
      const files = createMemo(() => store.files.map((x) => file.node(x)))
      const activeFile = createMemo(() => (store.activeFile ? file.node(store.activeFile) : undefined))

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
        files,
        openFile(path: string) {
          file.init(path).then(() => {
            setStore("files", (x) => [...x, path])
            setStore("activeFile", path)
          })
        },
        activeFile,
        setActiveFile(path: string | undefined) {
          setStore("activeFile", path)
        },
      }
    })()

    const result = {
      model,
      agent,
      file,
      session,
      context,
    }
    return result
  },
})
