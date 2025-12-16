import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import type { FileContent, FileNode, Model, Provider, File as FileStatus } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { makePersisted } from "@solid-primitives/storage"
import { DateTime } from "luxon"

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
  latest?: boolean
}
export type ModelKey = { providerID: string; modelID: string }

export type FileContext = { type: "file"; path: string; selection?: TextSelection }
export type ContextItem = FileContext

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return (
        !!provider?.models[model.modelID] &&
        providers
          .connected()
          .map((p) => p.id)
          .includes(model.providerID)
      )
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    // Automatically update model when agent changes
    createEffect(() => {
      const value = agent.current()
      if (value.model) {
        if (isModelValid(value.model))
          model.set({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
        // else
        //   toast.show({
        //     type: "warning",
        //     message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        //     duration: 3000,
        //   })
      }
    })

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
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
      const [store, setStore] = makePersisted(
        createStore<{
          user: (ModelKey & { visibility: "show" | "hide"; favorite?: boolean })[]
          recent: ModelKey[]
        }>({
          user: [],
          recent: [],
        }),
        { name: "model.v1" },
      )

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey>
      }>({
        model: {},
      })

      const available = createMemo(() =>
        providers.connected().flatMap((p) =>
          Object.values(p.models).map((m) => ({
            ...m,
            provider: p,
          })),
        ),
      )

      const latest = createMemo(() =>
        pipe(
          available(),
          filter((x) => Math.abs(DateTime.fromISO(x.release_date).diffNow().as("months")) < 6),
          groupBy((x) => x.provider.id),
          mapValues((models) =>
            pipe(
              models,
              groupBy((x) => x.family),
              values(),
              (groups) =>
                groups.flatMap((g) => {
                  const first = firstBy(g, [(x) => x.release_date, "desc"])
                  return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
                }),
            ),
          ),
          values(),
          flat(),
        ),
      )

      const list = createMemo(() =>
        available().map((m) => ({
          ...m,
          name: m.name.replace("(latest)", "").trim(),
          latest: m.name.includes("(latest)"),
        })),
      )

      const find = (key: ModelKey) => list().find((m) => m.id === key?.modelID && m.provider.id === key.providerID)

      const fallbackModel = createMemo(() => {
        if (sync.data.config.model) {
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of store.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        for (const p of providers.connected()) {
          if (p.id in providers.default()) {
            return {
              providerID: p.id,
              modelID: providers.default()[p.id],
            }
          }
        }

        throw new Error("No default model found")
      })

      const current = createMemo(() => {
        const a = agent.current()
        const key = getFirstValidModel(
          () => ephemeral.model[a.name],
          () => a.model,
          fallbackModel,
        )!
        return find(key)
      })

      const recent = createMemo(() => store.recent.map(find).filter(Boolean))

      const cycle = (direction: 1 | -1) => {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      function updateVisibility(model: ModelKey, visibility: "show" | "hide") {
        const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
        if (index >= 0) {
          setStore("user", index, { visibility })
        } else {
          setStore("user", store.user.length, { ...model, visibility })
        }
      }

      return {
        current,
        recent,
        list,
        cycle,
        set(model: ModelKey | undefined, options?: { recent?: boolean }) {
          batch(() => {
            setEphemeral("model", agent.current().name, model ?? fallbackModel())
            if (model) updateVisibility(model, "show")
            if (options?.recent && model) {
              const uniq = uniqueBy([model, ...store.recent], (x) => x.providerID + x.modelID)
              if (uniq.length > 5) uniq.pop()
              setStore("recent", uniq)
            }
          })
        },
        visible(model: ModelKey) {
          const user = store.user.find((x) => x.modelID === model.modelID && x.providerID === model.providerID)
          return (
            user?.visibility !== "hide" &&
            (latest().find((x) => x.modelID === model.modelID && x.providerID === model.providerID) ||
              user?.visibility === "show")
          )
        },
        setVisibility(model: ModelKey, visible: boolean) {
          updateVisibility(model, visible ? "show" : "hide")
        },
      }
    })()

    const file = (() => {
      const [store, setStore] = createStore<{
        node: Record<string, LocalFile>
      }>({
        node: Object.fromEntries(sync.data.node.map((x) => [x.path, x])),
      })

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

      // const resetNode = (path: string) => {
      //   setStore("node", path, {
      //     loaded: undefined,
      //     pinned: undefined,
      //     content: undefined,
      //     selection: undefined,
      //     scrollTop: undefined,
      //     folded: undefined,
      //     view: undefined,
      //     selectedChange: undefined,
      //   })
      // }

      const relative = (path: string) => path.replace(sync.data.path.directory + "/", "")

      const load = async (path: string) => {
        const relativePath = relative(path)
        await sdk.client.file.read({ path: relativePath }).then((x) => {
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
        // setStore("opened", (x) => {
        //   if (x.includes(relativePath)) return x
        //   return [
        //     ...opened()
        //       .filter((x) => x.pinned)
        //       .map((x) => x.path),
        //     relativePath,
        //   ]
        // })
        // setStore("active", relativePath)
        context.addActive()
        if (options?.pinned) setStore("node", path, "pinned", true)
        if (options?.view && store.node[relativePath].view === undefined) setStore("node", path, "view", options.view)
        if (store.node[relativePath].loaded) return
        return load(relativePath)
      }

      const list = async (path: string) => {
        return sdk.client.file.list({ path: path + "/" }).then((x) => {
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

      const searchFiles = (query: string) => sdk.client.find.files({ query, dirs: "false" }).then((x) => x.data!)
      const searchFilesAndDirectories = (query: string) =>
        sdk.client.find.files({ query, dirs: "true" }).then((x) => x.data!)

      sdk.event.listen((e) => {
        const event = e.details
        switch (event.type) {
          case "file.watcher.updated":
            const relativePath = relative(event.properties.file)
            if (relativePath.startsWith(".git/")) return
            if (store.node[relativePath]) load(relativePath)
            break
        }
      })

      return {
        node: async (path: string) => {
          if (!store.node[path] || !store.node[path].loaded) {
            await init(path)
          }
          return store.node[path]
        },
        update: (path: string, node: LocalFile) => setStore("node", path, reconcile(node)),
        open,
        load,
        init,
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
        searchFiles,
        searchFilesAndDirectories,
        relative,
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
        // active() {
        //   return store.activeTab ? file.active() : undefined
        // },
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
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
      file,
      context,
    }
    return result
  },
})
