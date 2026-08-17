import { createRoot, createSignal, getOwner, onCleanup, runWithOwner, type Accessor, type Owner } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { Path, VcsInfo } from "@/types"
import {
  DIR_IDLE_TTL_MS,
  MAX_DIR_STORES,
  type ChildOptions,
  type DirState,
  type IconCache,
  type MetaCache,
  type ProjectMeta,
  type State,
  type VcsCache,
} from "./types"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./eviction"
import { useQuery } from "@tanstack/solid-query"
import { QueryOptionsApi } from "../server-sync"
import { directoryKey, type DirectoryKey } from "./utils"
import type { ServerScope } from "@/utils/server-scope"
import type { Data } from "@opencode-ai/client/solid"
import { normalizeAgentList, normalizeProviderList } from "./utils"

export function createChildStoreManager(input: {
  owner: Owner
  connected: Accessor<boolean>
  scope: ServerScope
  persist: typeof persisted
  isBooting: (directory: string) => boolean
  isLoadingSessions: (directory: string) => boolean
  onBootstrap: (directory: string) => void
  onMcp: (directory: string, setStore: SetStoreFunction<State>) => void
  onDispose: (directory: string) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
  queryOptions: QueryOptionsApi
  data: Data
  global: {
    path: Path
  }
}) {
  const children: Record<string, [Store<State>, SetStoreFunction<State>]> = {}
  const vcsCache = new Map<string, VcsCache>()
  const metaCache = new Map<string, MetaCache>()
  const iconCache = new Map<string, IconCache>()
  const lifecycle = new Map<string, DirState>()
  const pins = new Map<string, number>()
  const ownerPins = new WeakMap<object, Set<string>>()
  const disposers = new Map<string, () => void>()
  const mcpDirectories = new Set<string>()
  const activeDirectories = new Set<string>()
  const activationToggles = new Map<string, (enabled: boolean) => void>()

  const markKey = (key: DirectoryKey) => {
    if (!key) return
    lifecycle.set(key, { lastAccessAt: Date.now() })
    runEviction(key)
  }

  const mark = (directory: string) => {
    const key = directoryKey(directory)
    markKey(key)
  }

  const pin = (directory: string) => {
    const key = directoryKey(directory)
    if (!key) return
    pins.set(key, (pins.get(key) ?? 0) + 1)
    markKey(key)
  }

  const unpin = (directory: string) => {
    const key = directoryKey(directory)
    if (!key) return
    const next = (pins.get(key) ?? 0) - 1
    if (next > 0) {
      pins.set(key, next)
      return
    }
    pins.delete(key)
    runEviction()
  }

  const pinned = (directory: string) => (pins.get(directoryKey(directory)) ?? 0) > 0

  const pinForOwner = (directory: string) => {
    const current = getOwner()
    if (!current) return
    if (current === input.owner) return
    const key = current as object
    const set = ownerPins.get(key)
    if (set?.has(directory)) return
    if (set) set.add(directory)
    if (!set) ownerPins.set(key, new Set([directory]))
    pin(directory)
    onCleanup(() => {
      const set = ownerPins.get(key)
      if (set) {
        set.delete(directory)
        if (set.size === 0) ownerPins.delete(key)
      }
      unpin(directory)
    })
  }

  function disposeDirectory(directory: DirectoryKey) {
    const key = directory
    if (
      !canDisposeDirectory({
        directory: key,
        hasStore: !!children[key],
        pinned: pinned(key),
        booting: input.isBooting(key),
        loadingSessions: input.isLoadingSessions(key),
      })
    ) {
      return false
    }

    vcsCache.delete(key)
    metaCache.delete(key)
    iconCache.delete(key)
    lifecycle.delete(key)
    mcpDirectories.delete(key)
    activeDirectories.delete(key)
    activationToggles.delete(key)
    const dispose = disposers.get(key)
    if (dispose) {
      dispose()
      disposers.delete(key)
    }
    delete children[key]
    input.onDispose(key)
    return true
  }

  function runEviction(skip?: string) {
    const stores = Object.keys(children)
    if (stores.length === 0) return
    const list = pickDirectoriesToEvict({
      stores,
      state: lifecycle,
      pins: new Set(stores.filter(pinned)),
      max: MAX_DIR_STORES,
      ttl: DIR_IDLE_TTL_MS,
      now: Date.now(),
    }).filter((directory) => directory !== skip)
    if (list.length === 0) return
    for (const directory of list) {
      if (!disposeDirectory(directoryKey(directory))) continue
    }
  }

  function ensureChild(directory: string) {
    const key = directoryKey(directory)
    if (!key) console.error("No directory provided")
    if (!children[key]) {
      const vcs = runWithOwner(input.owner, () =>
        input.persist(
          Persist.serverWorkspace(input.scope, directory, "vcs"),
          createStore({ value: undefined as VcsInfo | undefined }),
        ),
      )
      if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
      const vcsStore = vcs[0]
      vcsCache.set(key, { store: vcsStore, setStore: vcs[1], ready: vcs[3] })

      const meta = runWithOwner(input.owner, () =>
        input.persist(
          Persist.serverWorkspace(input.scope, directory, "project"),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
      metaCache.set(key, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        input.persist(
          Persist.serverWorkspace(input.scope, directory, "icon"),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error(input.translate("error.childStore.persistedProjectIconCreateFailed"))
      iconCache.set(key, { store: icon[0], setStore: icon[1], ready: icon[3] })

      const init = () =>
        createRoot((dispose) => {
          const initialMeta = meta[0].value
          const initialIcon = icon[0].value
          const [instanceQueriesEnabled, setInstanceQueriesEnabled] = createSignal(false)
          const lspQuery = useQuery(() => ({
            ...input.queryOptions.lsp(key),
            enabled: input.connected() && instanceQueriesEnabled(),
          }))
          const child = createStore<State>({
            project: "",
            projectMeta: initialMeta,
            icon: initialIcon,
            get provider_ready() {
              return (
                input.data.location.provider.list({ directory }) !== undefined &&
                input.data.location.model.list({ directory }) !== undefined
              )
            },
            get provider() {
              const provider = input.data.location.provider.list({ directory })
              const model = input.data.location.model.list({ directory })
              if (!provider || !model) return { all: new Map(), connected: [], default: {} }
              return normalizeProviderList(provider, model)
            },
            config: {},
            get path() {
              const location = input.data.location.info({ directory })
              return {
                state: "",
                config: "",
                worktree: location?.project.directory ?? "",
                directory: location?.directory ?? directory,
                home: input.global.path.home,
              }
            },
            status: "loading" as const,
            get agent() {
              return normalizeAgentList(input.data.location.agent.list({ directory }) ?? [])
            },
            get command() {
              return input.data.location.command.list({ directory }) ?? []
            },
            get reference() {
              return input.data.location.reference.list({ directory }) ?? []
            },
            get mcp_ready() {
              return input.data.location.mcp.server.list({ directory }) !== undefined
            },
            get mcp() {
              return Object.fromEntries(
                (input.data.location.mcp.server.list({ directory }) ?? []).map((server) => [server.name, server.status]),
              )
            },
            get mcp_resource() {
              return Object.fromEntries(
                (input.data.location.mcp.resource.list({ directory }) ?? []).map((resource) => [
                  `${resource.server}:${resource.uri}`,
                  resource,
                ]),
              )
            },
            get lsp_ready() {
              return instanceQueriesEnabled() && !lspQuery.isLoading
            },
            get lsp() {
              return lspQuery.isLoading ? [] : (lspQuery.data ?? [])
            },
            get vcs() {
              const vcs = input.data.location.vcs.info({ directory })
              if (!vcs) return vcsStore.value
              return { branch: vcs.branch.current, default_branch: vcs.branch.default }
            },
          })
          children[key] = child
          disposers.set(key, dispose)
          activationToggles.set(key, setInstanceQueriesEnabled)

          const onPersistedInit = (init: Promise<string> | string | null, run: () => void) => {
            if (!(init instanceof Promise)) return
            void init.then(() => {
              if (children[key] !== child) return
              run()
            })
          }

          onPersistedInit(vcs[2], () => {
            const cached = vcsStore.value
            if (!cached?.branch) return
            child[1]("vcs", (value) => value ?? cached)
          })

          onPersistedInit(meta[2], () => {
            if (child[0].projectMeta !== initialMeta) return
            child[1]("projectMeta", meta[0].value)
          })

          onPersistedInit(icon[2], () => {
            if (child[0].icon !== initialIcon) return
            child[1]("icon", icon[0].value)
          })
        })

      runWithOwner(input.owner, init)
    }
    markKey(key)
    const childStore = children[key]
    if (!childStore) throw new Error(input.translate("error.childStore.storeCreateFailed"))
    return childStore
  }

  function child(directory: string, options: ChildOptions = {}) {
    const key = directoryKey(directory)
    const childStore = ensureChild(directory)
    pinForOwner(key)
    if (options.mcp) enableMcp(directory, key, childStore)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap) activate(key)
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function peek(directory: string, options: ChildOptions = {}) {
    const key = directoryKey(directory)
    const childStore = ensureChild(directory)
    if (options.mcp) enableMcp(directory, key, childStore)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap) activate(key)
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function enableMcp(directory: string, key: DirectoryKey, childStore: [Store<State>, SetStoreFunction<State>]) {
    if (mcpDirectories.has(key)) return
    mcpDirectories.add(key)
    if (childStore[0].status !== "loading") input.onMcp(directory, childStore[1])
  }

  // Passive project metadata reads must not initialize the directory.
  // A real directory access enables these queries once for the store lifetime.
  function activate(key: DirectoryKey) {
    if (activeDirectories.has(key)) return
    activeDirectories.add(key)
    activationToggles.get(key)?.(true)
  }

  function disableMcp(directory: string) {
    const key = directoryKey(directory)
    if (!mcpDirectories.delete(key)) return
  }

  function projectMeta(directory: string, patch: ProjectMeta) {
    const key = directoryKey(directory)
    const [store, setStore] = ensureChild(directory)
    const cached = metaCache.get(key)
    if (!cached) return
    const previous = store.projectMeta ?? {}
    const icon = patch.icon ? { ...previous.icon, ...patch.icon } : previous.icon
    const commands = patch.commands ? { ...previous.commands, ...patch.commands } : previous.commands
    const next = {
      ...previous,
      ...patch,
      icon,
      commands,
    }
    cached.setStore("value", next)
    setStore("projectMeta", next)
  }

  function projectIcon(directory: string, value: string | undefined) {
    const key = directoryKey(directory)
    const [store, setStore] = ensureChild(directory)
    const cached = iconCache.get(key)
    if (!cached) return
    if (store.icon === value) return
    cached.setStore("value", value)
    setStore("icon", value)
  }

  function vcs(directory: string, value: VcsInfo) {
    const key = directoryKey(directory)
    const child = ensureChild(directory)
    const cached = vcsCache.get(key)
    if (!cached) return
    cached.setStore("value", value)
    child[1]("vcs", value)
  }

  return {
    children,
    ensureChild,
    child,
    peek,
    projectMeta,
    projectIcon,
    vcs,
    mark,
    pin,
    unpin,
    pinned,
    mcp: (directory: string) => mcpDirectories.has(directoryKey(directory)),
    active: (directory: string) => activeDirectories.has(directoryKey(directory)),
    disableMcp,
    disposeDirectory,
    runEviction,
    vcsCache,
    metaCache,
    iconCache,
  }
}
